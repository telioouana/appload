/**
 * The Subscriptions page's router (`verify-subscriptions`), run as a staff
 * member on the STAFF database role against the SHARED DEV DATABASE: only
 * organizations with a plan are listed, the tab counts add up, each state
 * tab holds what it says, and the picker offers only companies without one.
 * Read-only unless `--write`, which also exercises the four subscription
 * actions (change, renew, cancel, renew again) on Terceiro Teste Portal and
 * puts the row back as it was, notifications included.
 *
 * Run from apps/admin:
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/verify-subscriptions.ts [--write]
 */
import fs from "node:fs";

import { and, eq, gte, sql } from "drizzle-orm";

import { createDb } from "@workspace/db/db";
import { notification } from "@workspace/db/notifications";
import { organization } from "@workspace/db/users";
import { createCallerFactory } from "@workspace/trpc/init";
import { getStaffGates } from "@workspace/trpc/staff-gate";
import { getTenantGates } from "@workspace/trpc/tenant-gate";

import { organizationsRouter } from "@/backend/api/routers/organizations";
import { subscriptionsRouter } from "@/frontend/pages/subscriptions/server/procedures";
import { changedExpiry, extendedExpiry } from "@/frontend/pages/subscriptions/types";

const envValue = (env: string, name: string) => env.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();
const STAFF_URL = envValue(fs.readFileSync(".env", "utf8"), "DATABASE_URL");
const OWNER_URL = envValue(fs.readFileSync("../app/.env", "utf8"), "DATABASE_URL");
if (!STAFF_URL?.includes("appload_staff.") || !OWNER_URL) throw new Error("apps/admin/.env must carry the appload_staff DATABASE_URL, apps/app/.env the owner's");

process.env.DATABASE_URL ??= STAFF_URL;

const staff = createDb(STAFF_URL);
const STAFF_USER = "lFKSwK7GvBkvHjTmn3S1u8P3lvzdBx1X"; // Telio Ouana, appload/user
const TEST_ORG = "bdc445de-4e50-4b13-beb7-024fadbb22d1"; // Terceiro Teste Portal, seeded 2026-09-30

const context = {
    authApi: undefined as never,
    session: { user: { id: STAFF_USER, name: "harness" }, session: { id: "verify-subscriptions", userId: STAFF_USER } } as never,
    db: staff,
    app: "admin" as const,
    headers: new Headers(),
    waitUntil: undefined,
    staffGates: (id: string) => getStaffGates(staff, { userId: id }),
    tenantGates: (id: string) => getTenantGates(staff, { userId: id }),
};
const subscriptions = createCallerFactory(subscriptionsRouter)(context);
const organizations = createCallerFactory(organizationsRouter)(context);

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

    if (process.argv.includes("--write")) await writes();

    console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
}

/** The four actions on the test tenant, then the row and its notifications as they were. */
async function writes() {
    const owner = createDb(OWNER_URL!);
    const started = new Date();
    const read = async () => {
        const row = await owner.select({ plan: organization.subscriptionPlan, expiresAt: organization.subscriptionExpiresAt, cancelledAt: organization.subscriptionCancelledAt })
            .from(organization).where(eq(organization.id, TEST_ORG)).then((rows) => rows[0]);
        if (!row?.plan || !row.expiresAt) throw new Error("Terceiro Teste Portal must carry a plan with an end date");
        return { ...row, plan: row.plan, expiresAt: row.expiresAt };
    };
    const original = await read();
    const otherPlan = original.plan === "starter" ? "essential" : "starter";

    try {
        await organizations.setSubscription({ action: "change", id: TEST_ORG, plan: otherPlan });
        const changed = await read();
        // The server's "now" is a few seconds off this one; the conversion moves the end date by hours or months
        const expectedChange = changedExpiry(original.expiresAt, original.plan, otherPlan)!;
        check("change swaps the tier and converts what is left into time on it", changed.plan === otherPlan && Math.abs(changed.expiresAt.getTime() - expectedChange.getTime()) < 60_000 && changed.expiresAt.getTime() !== original.expiresAt.getTime(), { changed, expectedChange });

        await organizations.setSubscription({ action: "renew", id: TEST_ORG, months: 2 });
        const renewed = await read();
        check("renew adds the months to the current end date", renewed.expiresAt.getTime() === extendedExpiry(changed.expiresAt, 2).getTime() && renewed.plan === otherPlan, { renewed, expected: extendedExpiry(changed.expiresAt, 2) });

        await organizations.setSubscription({ action: "cancel", id: TEST_ORG });
        const cancelled = await read();
        check("cancel marks the row and keeps the paid end date", cancelled.cancelledAt !== null && cancelled.expiresAt.getTime() === renewed.expiresAt.getTime() && cancelled.plan === otherPlan, cancelled);
        const listed = await subscriptions.list({ dir: "asc", pageSize: 100, search: "Terceiro" });
        check("the list carries the cancellation", listed.items.some((row) => row.id === TEST_ORG && row.cancelledAt !== null && row.quota !== 0), listed.items.map((row) => [row.name, row.cancelledAt, row.quota]));
        const expiring = await subscriptions.list({ dir: "asc", pageSize: 100, status: "expiring", search: "Terceiro" });
        check("a cancelled row is not chased as expiring", !expiring.items.some((row) => row.id === TEST_ORG));

        await organizations.setSubscription({ action: "renew", id: TEST_ORG, months: 1 });
        const again = await read();
        check("renewing a cancelled row clears the cancellation", again.cancelledAt === null && again.expiresAt.getTime() === extendedExpiry(renewed.expiresAt, 1).getTime(), again);

        const notices = await owner.select({ params: notification.params }).from(notification)
            .where(and(eq(notification.organizationId, TEST_ORG), eq(notification.kind, "subscription.changed"), gte(notification.createdAt, started)));
        const actions = notices.map((row) => (row.params as { action?: string }).action).sort();
        check("each action notified the company once, naming itself", actions.join(",") === "cancel,change,renew,renew", actions);
    } finally {
        await owner.update(organization)
            .set({ subscriptionPlan: original.plan, subscriptionExpiresAt: original.expiresAt, subscriptionCancelledAt: original.cancelledAt })
            .where(eq(organization.id, TEST_ORG));
        await owner.delete(notification)
            .where(and(eq(notification.organizationId, TEST_ORG), eq(notification.kind, "subscription.changed"), gte(notification.createdAt, started)));
        const restored = await read();
        check("the test tenant is back as it was", restored.plan === original.plan && restored.expiresAt.getTime() === original.expiresAt.getTime() && restored.cancelledAt === original.cancelledAt, { restored, original });
    }
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
