/**
 * The admin's side of a support grant (`verify-support-access`): the
 * partners router, run as a staff member on the STAFF database role, reads
 * a company's own loads only while that company has opened the door, and
 * writes each read to the company's activity log.
 *
 * Two connections to the SHARED DEV DATABASE: the owner (from apps/app/.env,
 * which writes and revokes the grant as the company would) and the staff
 * role (this app's own DATABASE_URL), which the router runs on. The grant
 * and the log rows it causes are deleted at the end, pass or fail.
 *
 * Run from apps/admin:
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/verify-support-access.ts
 */
import fs from "node:fs";

import { and, eq, sql } from "drizzle-orm";

import { activityLog } from "@workspace/db/activity-log";
import { createDb } from "@workspace/db/db";
import { supportAccessGrant } from "@workspace/db/support";
import { createCallerFactory } from "@workspace/trpc/init";
import { getStaffGates } from "@workspace/trpc/staff-gate";
import { getTenantGates } from "@workspace/trpc/tenant-gate";

import { partnersRouter } from "@/frontend/pages/partners/server/procedures";

const envValue = (env: string, name: string) => env.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();
const adminEnv = fs.readFileSync(".env", "utf8");
const appEnv = fs.readFileSync("../app/.env", "utf8");

const STAFF_URL = envValue(adminEnv, "DATABASE_URL");
const OWNER_URL = envValue(appEnv, "DATABASE_URL");
if (!STAFF_URL?.includes("appload_staff.") || !OWNER_URL) throw new Error("apps/admin/.env must carry the appload_staff DATABASE_URL, apps/app/.env the owner's");

// The request log inside the router writes through the package singleton, which reads this
process.env.DATABASE_URL ??= STAFF_URL;

const staff = createDb(STAFF_URL);
const owner = createDb(OWNER_URL);

const SESSION_ID = "verify-support-access";
const STAFF_USER = "lFKSwK7GvBkvHjTmn3S1u8P3lvzdBx1X"; // Telio Ouana, appload/user
const A = { org: "42655a3f-0bd5-4e46-af29-9c5ee342a8aa", owner: "FT7QysKKfs5NKuut5i2S8Nhg6ItrwyuR" }; // Cliente Teste, shipper

const createCaller = createCallerFactory(partnersRouter);
const partners = createCaller({
    authApi: undefined as never,
    session: { user: { id: STAFF_USER, name: "harness" }, session: { id: SESSION_ID, userId: STAFF_USER } } as never,
    db: staff,
    app: "admin" as const,
    headers: new Headers(),
    waitUntil: undefined,
    staffGates: (id: string) => getStaffGates(staff, { userId: id }),
    tenantGates: (id: string) => getTenantGates(staff, { userId: id }),
});

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
    results.push({ name, ok, detail: ok ? undefined : JSON.stringify(detail) });
    console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : ` — ${JSON.stringify(detail)}`}`);
}

const viewsLogged = async () => (await owner
    .select({ id: activityLog.id })
    .from(activityLog)
    .where(and(eq(activityLog.sessionId, SESSION_ID), eq(activityLog.action, "support.loads.view"), eq(activityLog.organizationId, A.org)))).length;

async function main() {
    // The door is shut: the profile says so, and the loads read returns only
    // what staff may always see — the company's loads that name Appload
    const shut = await partners.organizationProfile({ id: A.org });
    check("the profile reads no grant while the door is shut", shut.supportAccess === null, shut.supportAccess);
    const always = (await partners.supportLoads({ organizationId: A.org })).length;
    const [{ n: total }] = await owner.execute<{ n: number }>(sql`select count(*)::int as n from movement where organization_id = ${A.org}`);
    const [{ n: withAppload }] = await owner.execute<{ n: number }>(sql`select count(*)::int as n from movement where organization_id = ${A.org} and (client_org_id = 'appload' or carrier_org_id = 'appload')`);
    check("shut, only the loads Appload is a party to come back", always === withAppload && always < total, { always, withAppload, total });
    const before = await viewsLogged();

    // The company opens it
    await owner.insert(supportAccessGrant).values({
        organizationId: A.org, grantedBy: A.owner, reason: "verify-support-access", expiresAt: new Date(Date.now() + 86_400_000),
    });
    const open = await partners.organizationProfile({ id: A.org });
    check("the profile reads the grant, its reason and who opened it", open.supportAccess?.reason === "verify-support-access" && Boolean(open.supportAccess.grantedByName), open.supportAccess);
    const loads = await partners.supportLoads({ organizationId: A.org });
    check("the loads come back under the grant", loads.length === Math.min(total, 50) && loads.length > always, { loads: loads.length, total, always });
    check("…with no money on them", !loads.some((row) => "sellTotal" in row || "buyTotal" in row || "payable" in row));
    check("every read is on the company's activity log", (await viewsLogged()) === before + 1);

    // And shuts it again
    await owner.update(supportAccessGrant).set({ revokedAt: new Date(), revokedBy: A.owner })
        .where(and(eq(supportAccessGrant.organizationId, A.org), eq(supportAccessGrant.reason, "verify-support-access")));
    check("revoked, only the Appload loads come back again", (await partners.supportLoads({ organizationId: A.org })).length === always);
}

async function cleanup() {
    await owner.delete(supportAccessGrant).where(eq(supportAccessGrant.reason, "verify-support-access"));
    await owner.delete(activityLog).where(eq(activityLog.sessionId, SESSION_ID));
}

main()
    .catch((error) => {
        console.error(error);
        results.push({ name: "harness ran to the end", ok: false, detail: String(error) });
    })
    .finally(async () => {
        await cleanup();
        const failed = results.filter((row) => !row.ok);
        console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
        process.exit(failed.length === 0 ? 0 : 1);
    });
