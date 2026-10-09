/**
 * End-to-end check of company modules (`verify-modules`): drives the
 * portal's routers as the CEO, a Gestor and an acting CEO of the shipper
 * test tenant (A), and as the CEO of the carrier test tenant (B), on the
 * SHARED DEV DATABASE.
 *
 * What it proves: the registry (null = all on, garbage ignored, the carrier
 * invariant); only the real CEO writes the OFF list (a Gestor and an acting
 * CEO are refused) and the row is refused when it is not legal; a module
 * switched off closes the doors that would create rows in it
 * (MODULE_DISABLED) while reads and the receiving side still answer; the
 * session reflects a change on the next request; the change is logged.
 *
 * Both tenants' `disabled_modules` are put back exactly as found, and every
 * row the run writes is deleted at the end, pass or fail.
 *
 * Run from apps/app:
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/verify-modules.ts
 */
import fs from "node:fs";

import { and, eq, inArray, like } from "drizzle-orm";

import { enabledModules, moduleConflict, modulesFor } from "@workspace/auth/organization-modules";
import { activityLog } from "@workspace/db/activity-log";
import { partnerConnection } from "@workspace/db/connections";
import { db } from "@workspace/db/db";
import { movement, movementEvent } from "@workspace/db/movements";
import { notification } from "@workspace/db/notifications";
import { memberPermission } from "@workspace/db/permissions";
import { member, organization, user } from "@workspace/db/users";
import { createCallerFactory } from "@workspace/trpc/init";
import { getStaffGates } from "@workspace/trpc/staff-gate";
import { getTenantGates } from "@workspace/trpc/tenant-gate";

import { appRouter } from "@/backend/api/routers/_app";
import { defaultTab } from "@/frontend/pages/movements/types";
import { kindsFor } from "@/frontend/pages/partners/types";

process.env.DATABASE_URL ??= fs.readFileSync(".env", "utf8").match(/^DATABASE_URL=(.+)$/m)![1]!.trim();

const SESSION_ID = "verify-modules";
const createCaller = createCallerFactory(appRouter);
const logged: Promise<unknown>[] = [];

const as = (userId: string) => createCaller({
    authApi: undefined as never,
    session: { user: { id: userId, name: "harness" }, session: { id: SESSION_ID, userId } } as never,
    db,
    app: "portal" as const,
    headers: new Headers(),
    waitUntil: (promise: Promise<unknown>) => { logged.push(promise); },
    staffGates: (id: string) => getStaffGates(db, { userId: id }),
    tenantGates: (id: string) => getTenantGates(db, { userId: id }),
});

const A = { user: "FT7QysKKfs5NKuut5i2S8Nhg6ItrwyuR", org: "42655a3f-0bd5-4e46-af29-9c5ee342a8aa" }; // shipper, owner
const B = { user: "a2R9UNA2NTiEo3FS7DxlwgBFUn8EDNU6", org: "9b7674e5-ea7b-416b-a199-6ca6842da718" }; // carrier, owner
const C = { org: "bdc445de-4e50-4b13-beb7-024fadbb22d1" }; // stranger shipper: Terceiro Teste Portal

const origin = { state: "Nampula Province", address: "Nampula, Mozambique", country: "Mozambique", placeId: "ChIJOaE2a7M1xhgRdN3KTEt2F8I" };
const destination = { state: "Gauteng", address: "Johannesburg, South Africa", country: "South Africa", placeId: "ChIJUWpA8GgMlR4RQUDTsdnJiiM" };

const HOUR = 3_600_000;
const movementsHere: string[] = [];
const results: { name: string; ok: boolean }[] = [];
const original = new Map<string, string[] | null>();

function check(name: string, ok: boolean, detail?: unknown) {
    results.push({ name, ok });
    console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : ` — ${JSON.stringify(detail)}`}`);
}

async function refusal(run: () => Promise<unknown>): Promise<string | null> {
    try {
        await run();
        return null;
    } catch (error) {
        return (error as { message?: string }).message ?? String(error);
    }
}

/** A harness person in tenant A with the given profile. */
async function person(role: "admin" | "operations"): Promise<{ user: string; member: string }> {
    const id = `harness-mod-${role}-${crypto.randomUUID().slice(0, 8)}`;
    await db.insert(user).values({ id, name: `Harness ${role}`, email: `${id}@harness.local`, emailVerified: true, type: "shipper", status: "active" });
    const memberId = crypto.randomUUID();
    await db.insert(member).values({ id: memberId, organizationId: A.org, userId: id, role, createdAt: new Date() });
    return { user: id, member: memberId };
}

function registryChecks() {
    check("registry: null = every module the company can have", enabledModules("shipper", null).size === modulesFor("shipper").length && enabledModules("carrier", null).size === 7);
    check("registry: a shipper never has subcontracting", !modulesFor("shipper").includes("subcontracting"));
    const garbage = enabledModules("carrier", ["bogus", 42, "map"]);
    check("registry: garbage in the column is ignored, a known id counts", !garbage.has("map") && garbage.size === 6);
    check("registry: not a list = all on", enabledModules("carrier", "map").size === 7);
    check("registry: a carrier keeps at least one way to move", moduleConflict("carrier", ["own-fleet", "subcontracting"]) === "NOTHING_LEFT_TO_MOVE");
    check("registry: a carrier may be a pure broker", moduleConflict("carrier", ["own-fleet"]) === null);
    check("registry: a shipper cannot switch what it does not have", moduleConflict("shipper", ["subcontracting"]) === "NOT_APPLICABLE");
    check("registry: the empty list is legal", moduleConflict("shipper", []) === null);
    check("defaultTab: a carrier without its own trucks opens on partners", defaultTab("carrier", ["subcontracting"]) === "partners" && defaultTab("carrier", ["own-fleet"]) === "own");
    check("kindsFor: a carrier without subcontracting lists no transporters", !(kindsFor as (t: "carrier", m: readonly string[]) => string[])("carrier", ["own-fleet"]).includes("transporters"));
}

async function main() {
    for (const org of [A.org, B.org]) {
        const [row] = await db.select({ disabled: organization.disabledModules }).from(organization).where(eq(organization.id, org));
        original.set(org, row?.disabled ?? null);
    }
    await db.update(organization).set({ disabledModules: null }).where(inArray(organization.id, [A.org, B.org]));

    registryChecks();

    const ceo = as(A.user);
    const b = as(B.user);
    const gestor = await person("admin");
    const operations = await person("operations");
    const g = as(gestor.user);
    const o = as(operations.user);

    // --- Who writes
    const fresh = await ceo.me.session();
    check("null column reads as every module on, not configured", !fresh.modulesConfigured && fresh.modules.length === modulesFor("shipper").length);
    check("the CEO records the answers", (await refusal(() => ceo.me.setModules({ disabled: [] }))) === null);
    const answered = await ceo.me.session();
    check("…and the session says configured on the next request", answered.modulesConfigured && answered.modules.length === modulesFor("shipper").length);
    check("a Gestor cannot", (await refusal(() => g.me.setModules({ disabled: [] }))) === "NOT_ALLOWED");
    check("Operações cannot", (await refusal(() => o.me.setModules({ disabled: [] }))) === "NOT_ALLOWED");

    await db.insert(memberPermission).values({
        organizationId: A.org, memberId: operations.member, kind: "acting_owner", permission: null,
        startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + HOUR), grantedBy: A.user,
    });
    const acting = await o.me.session();
    check("the acting CEO is level 3", acting.actingOwner && acting.level === 3);
    check("…and still cannot reshape the company", (await refusal(() => o.me.setModules({ disabled: ["chats"] }))) === "NOT_ALLOWED");

    check("the row is refused when a shipper switches subcontracting", (await refusal(() => ceo.me.setModules({ disabled: ["subcontracting"] }))) === "NOT_APPLICABLE");
    check("the row is refused when a carrier switches both ways off", (await refusal(() => b.me.setModules({ disabled: ["own-fleet", "subcontracting"] }))) === "NOTHING_LEFT_TO_MOVE");

    // --- A shipper with no trucks of its own
    await ceo.me.setModules({ disabled: ["own-fleet", "standing-orders", "rentals", "chats", "map", "analytics"] });
    const off = await ceo.me.session();
    check("the session lists only what is on", off.modules.length === 0, off.modules);
    check("own-fleet off: no trip on its own trucks", (await refusal(() => ceo.movements.create({
        execution: "own-fleet", origin, destination, cargoDescription: "HARNESS modules own trip",
    }))) === "MODULE_DISABLED");
    check("own-fleet off: a partner order is still placed", await refusal(async () => {
        const made = await ceo.movements.create({ execution: "partner", carrierName: "HARNESS Transportes", origin, destination, cargoDescription: "HARNESS modules partner" });
        movementsHere.push(made.id);
    }) === null);
    check("own-fleet off: no truck is registered", (await refusal(() => ceo.fleet.vehicles.register({ kind: "truck", regPlate: "HAR 001 MP" } as never))) === "MODULE_DISABLED");
    check("own-fleet off: no driver is registered", (await refusal(() => ceo.drivers.register({ name: "Harness" } as never))) === "MODULE_DISABLED");
    check("own-fleet off: the fleet list still answers", (await refusal(() => ceo.fleet.vehicles.list({ kind: "truck", page: 1, pageSize: 5 } as never))) !== "MODULE_DISABLED");
    check("standing-orders off: no multi-trip order", (await refusal(() => ceo.contracts.create({} as never))) === "MODULE_DISABLED");
    check("rentals off: no rental", (await refusal(() => ceo.rentals.create({} as never))) === "MODULE_DISABLED");
    check("chats off: nothing is sent", (await refusal(() => ceo.threads.send({} as never))) === "MODULE_DISABLED");
    check("chats off: the unread count still answers", (await refusal(() => ceo.threads.unread())) !== "MODULE_DISABLED");
    check("map off: the overview is closed", (await refusal(() => ceo.map.overview())) === "MODULE_DISABLED");
    check("analytics off: the money report is closed", (await refusal(() => ceo.analytics.money({}))) === "MODULE_DISABLED");
    check("analytics off: the pipeline counts still answer", (await refusal(() => ceo.analytics.pipeline())) !== "MODULE_DISABLED");

    // --- A transporter that never passes work on
    await b.me.setModules({ disabled: [] });
    let placed: { id: string; version: number } | null = null;
    check("subcontracting on: the transporter places a partner order", await refusal(async () => {
        const made = await b.movements.create({ execution: "partner", carrierName: "HARNESS Transportes", origin, destination, cargoDescription: "HARNESS modules subcontract" });
        movementsHere.push(made.id);
        const row = await b.movements.get({ id: made.id });
        placed = { id: made.id, version: row.version };
    }) === null);
    await b.me.setModules({ disabled: ["subcontracting"] });
    check("subcontracting off: the session says so", !(await b.me.session()).modules.includes("subcontracting"));
    check("subcontracting off: no partner order", (await refusal(() => b.movements.create({
        execution: "partner", carrierName: "HARNESS Transportes", origin, destination, cargoDescription: "HARNESS modules refused",
    }))) === "MODULE_DISABLED");
    check("subcontracting off: no request to a transporter", (await refusal(() => b.partners.request({ organizationId: A.org, relation: "subcontract" }))) === "MODULE_DISABLED");
    check("subcontracting off: a client is still asked", (await refusal(() => b.partners.request({ organizationId: C.org, relation: "client-carrier" }))) !== "MODULE_DISABLED");
    if (placed) {
        const current = placed as { id: string; version: number };
        check("subcontracting off: no offer goes out", (await refusal(() => b.movements.offer({ id: current.id, expectedVersion: current.version }))) === "MODULE_DISABLED");
        check("subcontracting off: no quote round", (await refusal(() => b.movements.sendRequests({ id: current.id, expectedVersion: current.version, carrierOrgIds: [A.org] }))) === "MODULE_DISABLED");
        check("subcontracting off: the order it already placed still reads", (await refusal(() => b.movements.get({ id: current.id }))) === null);
    }
    await b.me.setModules({ disabled: ["own-fleet"] });
    check("own-fleet off on a transporter: the session keeps subcontracting", (await b.me.session()).modules.includes("subcontracting"));

    // --- The record
    const rows = await db.select({ action: activityLog.action, params: activityLog.params })
        .from(activityLog).where(and(eq(activityLog.sessionId, SESSION_ID), eq(activityLog.action, "me.setModules")));
    check("every change is on the activity log with the ids switched off", rows.length >= 4 && rows.some((row) => String(row.params.disabled ?? "").includes("own-fleet")), rows.map((row) => row.params));
}

async function cleanup() {
    await Promise.allSettled(logged);
    for (const [org, disabled] of original) {
        await db.update(organization).set({ disabledModules: disabled }).where(eq(organization.id, org));
    }
    const leftovers = await db.select({ id: movement.id }).from(movement)
        .where(and(inArray(movement.organizationId, [A.org, B.org]), like(movement.cargoDescription, "HARNESS modules%")));
    const movements = [...new Set([...movementsHere, ...leftovers.map((row) => row.id)])];
    if (movements.length > 0) {
        await db.delete(notification).where(and(eq(notification.entityType, "movement"), inArray(notification.entityId, movements)));
        await db.delete(movementEvent).where(inArray(movementEvent.movementId, movements));
        await db.delete(movement).where(inArray(movement.id, movements));
    }
    // The one connection the run may have asked for; never the real A–B pair
    await db.delete(partnerConnection).where(and(eq(partnerConnection.requesterOrgId, B.org), eq(partnerConnection.targetOrgId, C.org), eq(partnerConnection.status, "pending")));
    await db.delete(member).where(like(member.userId, "harness-mod-%"));
    await db.delete(user).where(like(user.id, "harness-mod-%"));
    await db.delete(activityLog).where(eq(activityLog.sessionId, SESSION_ID));
}

main()
    .catch((error) => {
        console.error(error);
        results.push({ name: "harness crashed", ok: false });
    })
    .finally(async () => {
        await cleanup().catch((error) => console.error("cleanup failed", error));
        const failed = results.filter((result) => !result.ok);
        console.log(`\n${results.length - failed.length}/${results.length} passed`);
        process.exit(failed.length > 0 ? 1 : 0);
    });
