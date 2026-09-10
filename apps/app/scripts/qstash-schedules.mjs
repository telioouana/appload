/**
 * Creates (or updates) the portal's QStash schedules — the source of truth
 * for what runs when, now that Vercel Cron is out of the picture (Hobby
 * refuses anything more frequent than daily).
 *
 * Idempotent: every schedule carries a stable `Upstash-Schedule-Id`, so
 * re-running replaces the existing definition instead of stacking duplicates.
 * The ids are the portal's own — the admin's `appload-tracking` is a
 * different schedule pointing at a different app, and must never be reused.
 *
 * Usage:
 *   node apps/app/scripts/qstash-schedules.mjs                 # list only
 *   node apps/app/scripts/qstash-schedules.mjs --apply         # create/update
 *   node apps/app/scripts/qstash-schedules.mjs --apply --base https://app.example.com
 *
 * Reads QSTASH_TOKEN and NEXT_PUBLIC_PORTAL_URL from apps/app/.env or the
 * environment. The destination must be a public production URL — QStash
 * cannot reach localhost, and per-deployment preview URLs change every push.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function env(key) {
    if (process.env[key]) {
        return process.env[key];
    }

    try {
        const file = fs.readFileSync(path.join(root, "apps/app/.env"), "utf8");
        const match = file.match(new RegExp(`^${key}=(.+)$`, "m"));
        return match ? match[1].trim() : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Maputo is UTC+2 with no DST, but the schedule carries CRON_TZ anyway so the
 * intent is readable and stays correct if the app ever serves another zone.
 *
 * Tracking fires every 15 minutes across each window rather than at three
 * exact times: the handler derives the attempt from what it has already sent
 * (see @workspace/domain/tracking/movement-slot), so extra ticks are cheap no-ops
 * and a missed tick simply heals on the next one.
 */
const SCHEDULES = [
    {
        id: "appload-app-tracking",
        path: "/api/cron/trips-tracking",
        cron: "CRON_TZ=Africa/Maputo */15 8-9,17-18 * * *",
        note: "trip location requests, 08:00-09:45 and 17:00-18:45 Maputo",
    },
    {
        id: "appload-app-notifications",
        path: "/api/cron/notifications",
        cron: "*/5 * * * *",
        note: "materializes admin order events and sends the notification email outbox",
    },
];

const token = env("QSTASH_TOKEN");

if (!token) {
    throw new Error("QSTASH_TOKEN not found in apps/app/.env or the environment");
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const baseFlag = args.indexOf("--base");
const baseUrl = (baseFlag !== -1 ? args[baseFlag + 1] : env("NEXT_PUBLIC_PORTAL_URL"))?.replace(/\/$/, "");

if (!baseUrl) {
    throw new Error("No base URL: pass --base https://... or set NEXT_PUBLIC_PORTAL_URL");
}

if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
    throw new Error(`QStash cannot reach ${baseUrl} — use the public production URL`);
}

const qstash = async (method, endpoint, init = {}) => {
    const response = await fetch(`https://qstash.upstash.io/v2${endpoint}`, {
        ...init,
        method,
        headers: { Authorization: `Bearer ${token}`, ...init.headers },
    });

    if (!response.ok) {
        throw new Error(`QStash ${method} ${endpoint} -> ${response.status}: ${await response.text()}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
};

const existing = await qstash("GET", "/schedules");
const byId = new Map((existing ?? []).map((schedule) => [schedule.scheduleId, schedule]));

console.log(`base URL: ${baseUrl}`);
console.log(`${existing?.length ?? 0} schedule(s) currently registered\n`);

const report = [];

for (const schedule of SCHEDULES) {
    const destination = `${baseUrl}${schedule.path}`;
    const current = byId.get(schedule.id);
    const unchanged = current?.cron === schedule.cron && current?.destination === destination;

    if (!apply) {
        report.push({
            id: schedule.id,
            cron: schedule.cron,
            action: unchanged ? "up to date" : current ? "would update" : "would create",
        });
        continue;
    }

    if (unchanged) {
        report.push({ id: schedule.id, cron: schedule.cron, action: "up to date" });
        continue;
    }

    // Publishing with the same schedule id replaces the previous definition.
    // The destination goes into the path raw — QStash reads the scheme from
    // it and rejects a percent-encoded URL as "invalid scheme".
    await qstash("POST", `/schedules/${destination}`, {
        headers: {
            "Upstash-Cron": schedule.cron,
            "Upstash-Schedule-Id": schedule.id,
            // The handlers are idempotent and self-healing, so a retry can
            // never double-send; let QStash retry transient 5xx/timeouts
            "Upstash-Retries": "3",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ source: "qstash-schedule", id: schedule.id }),
    });

    report.push({ id: schedule.id, cron: schedule.cron, action: current ? "updated" : "created" });
}

console.table(report);

if (!apply) {
    console.log("\ndry run — pass --apply to write these schedules");
}
