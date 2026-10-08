/**
 * The Subscriptions page's router (`verify-subscriptions`), run as a staff
 * member on the STAFF database role against the SHARED DEV DATABASE: only
 * organizations with a plan are listed, the tab counts add up, each state
 * tab holds what it says, and the picker offers only companies without one.
 * Read-only — nothing is written.
 *
 * Run from apps/admin:
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/verify-subscriptions.ts
 */
import fs from "node:fs";

import { sql } from "drizzle-orm";

import { createDb } from "@workspace/db/db";
import { createCallerFactory } from "@workspace/trpc/init";
import { getStaffGates } from "@workspace/trpc/staff-gate";
import { getTenantGates } from "@workspace/trpc/tenant-gate";

import { subscriptionsRouter } from "@/frontend/pages/subscriptions/server/procedures";

const envValue = (env: string, name: string) => env.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();
const STAFF_URL = envValue(fs.readFileSync(".env", "utf8"), "DATABASE_URL");
if (!STAFF_URL?.includes("appload_staff.")) throw new Error("apps/admin/.env must carry the appload_staff DATABASE_URL");

process.env.DATABASE_URL ??= STAFF_URL;

const staff = createDb(STAFF_URL);
const STAFF_USER = "lFKSwK7GvBkvHjTmn3S1u8P3lvzdBx1X"; // Telio Ouana, appload/user

const subscriptions = createCallerFactory(subscriptionsRouter)({
    authApi: undefined as never,
    session: { user: { id: STAFF_USER, name: "harness" }, session: { id: "verify-subscriptions", userId: STAFF_USER } } as never,
    db: staff,
    app: "admin" as const,
    headers: new Headers(),
    waitUntil: undefined,
    staffGates: (id: string) => getStaffGates(staff, { userId: id }),
    tenantGates: (id: string) => getTenantGates(staff, { userId: id }),
});

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
    if (!ok) failures += 1;
    console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : ` — ${JSON.stringify(detail)}`}`);
}

const count = async (where: ReturnType<typeof sql>) =>
    (await staff.execute<{ n: number }>(sql`select count(*)::int as n from organization where ${where}`))[0]?.n ?? 0;

async function main() {
    const base = { dir: "asc" as const, pageSize: 100 };
    const all = await subscriptions.list(base);

    const planned = await count(sql`subscription_plan is not null`);
    check("every organization with a plan is listed, nothing else", all.total === planned && all.counts.all === planned, { total: all.total, counts: all.counts, planned });
    check("rows all carry a plan", all.items.every((row) => row.plan !== null));
    check("the counts add up: all = active + expired", all.counts.all === all.counts.active + all.counts.expired, all.counts);
    check("expiring is a slice of active", all.counts.expiring <= all.counts.active, all.counts);

    const now = new Date();
    for (const status of ["active", "expiring", "expired"] as const) {
        const page = await subscriptions.list({ ...base, status });
        const holds = page.items.every((row) => {
            const days = row.expiresAt ? (row.expiresAt.getTime() - now.getTime()) / 86_400_000 : Infinity;
            return status === "expired" ? days <= 0 : status === "expiring" ? days > 0 && days <= 30 : days > 0;
        });
        check(`the ${status} tab holds only ${status} rows and matches its count`, holds && page.total === all.counts[status], { total: page.total, count: all.counts[status] });
    }

    const expired = all.items.filter((row) => row.expiresAt && row.expiresAt <= now);
    check("an expired row has nothing to spend", expired.every((row) => row.quota === 0), expired.map((row) => [row.name, row.quota]));
    const open = all.items.filter((row) => !row.expiresAt);
    check("an open-ended row carries its tier's quota", open.every((row) => row.quota === null || row.quota > 0), open.map((row) => [row.name, row.plan, row.quota]));

    const first = all.items[0];
    if (first) {
        const found = await subscriptions.list({ ...base, search: first.name.slice(0, 6) });
        check("search by name finds the row", found.items.some((row) => row.id === first.id), { search: first.name.slice(0, 6), got: found.items.map((row) => row.name) });
        const byPlan = await subscriptions.list({ ...base, plan: first.plan });
        check("the plan filter keeps only that tier", byPlan.items.length > 0 && byPlan.items.every((row) => row.plan === first.plan));
    }

    const byExpiry = await subscriptions.list({ ...base, sort: "expires", dir: "desc" });
    const dates = byExpiry.items.map((row) => row.expiresAt?.getTime() ?? null);
    const withDate = dates.filter((value): value is number => value !== null);
    const nullsLast = dates.indexOf(null) === -1 || dates.slice(dates.indexOf(null)).every((value) => value === null);
    check("sort by expiry puts dates in order and open-ended rows last", nullsLast && withDate.every((value, index) => index === 0 || (withDate[index - 1] as number) >= value), dates);

    const candidates = await subscriptions.candidates({ search: "" });
    check("the picker offers only companies without a plan", candidates.length > 0 && candidates.every((row) => !all.items.some((listed) => listed.id === row.id)), candidates.length);
    const none = await subscriptions.candidates({ search: first?.name ?? "zzz" });
    check("a listed company is not offered again", !none.some((row) => row.id === first?.id), none.map((row) => row.name));

    console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
