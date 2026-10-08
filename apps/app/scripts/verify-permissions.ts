/**
 * End-to-end check of per-person permissions (`verify-permissions`): drives
 * the portal's routers as people of four profiles in the shipper test tenant
 * (A) on the SHARED DEV DATABASE — its owner (CEO) and three harness members
 * made for the run: a Gestor, a Procurement and an Operações.
 *
 * What it proves: the resolver (defaults, grants, removals, windows, the
 * acting-CEO lift); prices and the books reach each profile as the matrix
 * says, on the list, the detail, the cashflow strip and the CSV; the doors
 * refuse what a profile lacks (export, payments, status, prices typed by
 * somebody who cannot see them); a change counts on the next request and a
 * lapsed or future window does not; and the team router's rules — the level
 * rule, the ceiling, nobody edits themselves, the acting CEO.
 *
 * Every row it writes is deleted at the end, pass or fail.
 *
 * Run from apps/app:
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/verify-permissions.ts
 */
import fs from "node:fs";

import { and, eq, inArray, like } from "drizzle-orm";

import { effectiveAccess, PROFILE_DEFAULTS, type PermissionChange } from "@workspace/auth/organization-permissions";
import { activityLog } from "@workspace/db/activity-log";
import { db } from "@workspace/db/db";
import { movement, movementEvent } from "@workspace/db/movements";
import { notification } from "@workspace/db/notifications";
import { memberPermission } from "@workspace/db/permissions";
import { member, user } from "@workspace/db/users";
import { createCallerFactory } from "@workspace/trpc/init";
import { getStaffGates } from "@workspace/trpc/staff-gate";
import { getTenantGates } from "@workspace/trpc/tenant-gate";

import { appRouter } from "@/backend/api/routers/_app";

process.env.DATABASE_URL ??= fs.readFileSync(".env", "utf8").match(/^DATABASE_URL=(.+)$/m)![1]!.trim();

const SESSION_ID = "verify-permissions";
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

const origin = { state: "Nampula Province", address: "Nampula, Mozambique", country: "Mozambique", placeId: "ChIJOaE2a7M1xhgRdN3KTEt2F8I" };
const destination = { state: "Gauteng", address: "Johannesburg, South Africa", country: "South Africa", placeId: "ChIJUWpA8GgMlR4RQUDTsdnJiiM" };

const HOUR = 3_600_000;

const usersHere: string[] = [];
const membersHere: string[] = [];
const movementsHere: string[] = [];
const results: { name: string; ok: boolean }[] = [];

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
async function person(role: "admin" | "procurement" | "operations"): Promise<{ user: string; member: string }> {
    const id = `harness-perm-${role}-${crypto.randomUUID().slice(0, 8)}`;
    await db.insert(user).values({ id, name: `Harness ${role}`, email: `${id}@harness.local`, emailVerified: true, type: "shipper", status: "active" });
    usersHere.push(id);
    const memberId = crypto.randomUUID();
    await db.insert(member).values({ id: memberId, organizationId: A.org, userId: id, role, createdAt: new Date() });
    membersHere.push(memberId);
    return { user: id, member: memberId };
}

async function change(memberId: string, row: { kind: PermissionChange["kind"]; permission?: string; startsAt?: Date; endsAt?: Date | null }) {
    const [made] = await db.insert(memberPermission).values({
        organizationId: A.org,
        memberId,
        kind: row.kind,
        permission: row.permission ?? null,
        startsAt: row.startsAt ?? new Date(Date.now() - 60_000),
        endsAt: row.endsAt ?? null,
        grantedBy: A.user,
    }).returning({ id: memberPermission.id });
    return made!.id;
}

const revokeAll = (memberId: string) => db.update(memberPermission).set({ revokedAt: new Date() }).where(eq(memberPermission.memberId, memberId));

function resolverChecks() {
    const now = new Date();
    const at = (offsetHours: number) => new Date(now.getTime() + offsetHours * HOUR);
    const row = (kind: PermissionChange["kind"], permission: string | null, startsAt: Date, endsAt: Date | null, createdAt = startsAt): PermissionChange =>
        ({ kind, permission, startsAt, endsAt, revokedAt: null, createdAt });

    const ops = effectiveAccess("operations", [], now);
    check("resolver: Operações starts from its defaults", ops.level === 1 && ops.permissions.size === PROFILE_DEFAULTS.operations.length && !ops.permissions.has("price:read"));
    check("resolver: a live grant adds", effectiveAccess("operations", [row("grant", "price:read", at(-1), at(1))], now).permissions.has("price:read"));
    check("resolver: a lapsed grant does not", !effectiveAccess("operations", [row("grant", "price:read", at(-2), at(-1))], now).permissions.has("price:read"));
    check("resolver: a future grant does not yet", !effectiveAccess("operations", [row("grant", "price:read", at(1), at(2))], now).permissions.has("price:read"));
    check("resolver: a removal takes a default away", !effectiveAccess("admin", [row("remove", "finance:read", at(-1), null)], now).permissions.has("finance:read"));
    check("resolver: the later of two changes wins", effectiveAccess("operations", [
        row("grant", "price:read", at(-3), null, at(-3)),
        row("remove", "price:read", at(-2), null, at(-2)),
    ], now).permissions.has("price:read") === false);
    check("resolver: a revoked row never counts", !effectiveAccess("operations", [{ ...row("grant", "price:read", at(-1), null), revokedAt: at(-0.5) }], now).permissions.has("price:read"));
    check("resolver: the CEO cannot be reduced", effectiveAccess("owner", [row("remove", "price:read", at(-1), null)], now).permissions.has("price:read"));
    const acting = effectiveAccess("operations", [row("acting_owner", null, at(-1), at(1))], now);
    check("resolver: an acting CEO is level 3 with every permission", acting.level === 3 && acting.actingOwner && acting.permissions.has("security:manage"));
    check("resolver: an acting window that ended is over", effectiveAccess("operations", [row("acting_owner", null, at(-2), at(-1))], now).level === 1);
}

async function main() {
    resolverChecks();

    const ceo = as(A.user);
    const gestor = await person("admin");
    const procurement = await person("procurement");
    const operations = await person("operations");
    const g = as(gestor.user);
    const p = as(procurement.user);
    const o = as(operations.user);

    // A partner order placed with a transporter off the portal, priced, so
    // there is a price, a settlement and a margin to read
    const order = await ceo.movements.create({
        execution: "partner", carrierName: "HARNESS Transportes", origin, destination,
        cargoDescription: "HARNESS permissions", status: "booked",
        buy: { total: 1000, currency: "MZN" },
    });
    movementsHere.push(order.id);

    // --- Prices and the books, by profile
    const asCeo = await ceo.movements.get({ id: order.id });
    const asGestor = await g.movements.get({ id: order.id });
    const asProcurement = await p.movements.get({ id: order.id });
    const asOps = await o.movements.get({ id: order.id });

    check("CEO reads the price, the settlement and the margin", asCeo.money.payable?.total === 1000 && asCeo.money.payable?.settled === 0 && asCeo.money.margin !== null);
    check("Gestor reads the books like the CEO", asGestor.money.payable?.settled === 0 && asGestor.money.margin !== null);
    check("Procurement reads the price but no settlement, invoice or margin",
        asProcurement.money.payable?.total === 1000 && asProcurement.money.payable?.settled === null
        && asProcurement.money.payable?.settlement === null && asProcurement.money.margin === null, asProcurement.money);
    check("Operações reads no money at all", asOps.money.payable === null && asOps.money.receivable === null && asOps.money.margin === null && asOps.payable === null, asOps.money);
    check("Operações is not told the price is missing either", !asOps.flags.includes("NO_PRICE"));

    const listInput = { scope: "orders" as const, section: "all" as const, page: 1, pageSize: 50, sort: "loading" as const, dir: "desc" as const, search: "HARNESS permissions" };
    const opsRow = (await o.movements.list(listInput as never)).items.find((item) => item.id === order.id);
    const procurementRow = (await p.movements.list(listInput as never)).items.find((item) => item.id === order.id);
    check("the list hides the price from Operações", opsRow !== undefined && opsRow.payable === null, opsRow?.payable);
    check("the list shows Procurement the price", procurementRow?.payable?.total === 1000, procurementRow?.payable);

    const opsCash = await o.movements.cashflow({ scope: "orders", section: "all" });
    const procurementCash = await p.movements.cashflow({ scope: "orders", section: "all" });
    const ceoCash = await ceo.movements.cashflow({ scope: "orders", section: "all" });
    check("the cashflow strip is empty without finance:read", opsCash.lines.length === 0 && procurementCash.lines.length === 0);
    check("the cashflow strip has lines for the CEO", ceoCash.lines.length > 0);

    // --- The doors
    const exportInput = { scope: "orders" as const, section: "all" as const, sort: "loading" as const, dir: "desc" as const, search: "HARNESS permissions" };
    check("Operações cannot export", (await refusal(() => o.movements.export(exportInput as never))) === "NOT_ALLOWED");
    check("Procurement cannot export", (await refusal(() => p.movements.export(exportInput as never))) === "NOT_ALLOWED");
    check("Gestor exports", (await refusal(() => g.movements.export(exportInput as never))) === null);

    const payment = { id: order.id, expectedVersion: asCeo.version, leg: "buy" as const, amount: 100 };
    check("Operações cannot record a payment", (await refusal(() => o.movements.recordPayment(payment))) === "NOT_ALLOWED");
    check("Procurement cannot record a payment", (await refusal(() => p.movements.recordPayment(payment))) === "NOT_ALLOWED");

    check("Procurement cannot move a booked load on", (await refusal(() => p.movements.transition({ id: order.id, expectedVersion: asCeo.version, to: "at-loading" } as never))) === "NOT_ALLOWED");
    check("Operações cannot cancel an order", (await refusal(() => o.movements.transition({ id: order.id, expectedVersion: asCeo.version, to: "cancelled", note: "harness" } as never))) === "NOT_ALLOWED");
    check("Operações cannot re-price a load", (await refusal(() => o.movements.update({ id: order.id, expectedVersion: asCeo.version, buy: { total: 2000, currency: "MZN" } } as never))) === "NOT_ALLOWED");
    check("Operações writes the rig", (await refusal(() => o.movements.update({ id: order.id, expectedVersion: asCeo.version, driverName: "Harness Driver" } as never))) === null);
    check("Procurement cannot write the rig", (await refusal(async () => {
        const { version } = await ceo.movements.get({ id: order.id });
        return p.movements.update({ id: order.id, expectedVersion: version, driverName: "Other" } as never);
    })) === "NOT_ALLOWED");
    check("Operações cannot place a partner order", (await refusal(() => o.movements.create({
        execution: "partner", carrierName: "HARNESS Transportes", origin, destination, cargoDescription: "HARNESS permissions refused",
    }))) === "NOT_ALLOWED");
    check("Operações cannot type a price on its own trip", (await refusal(() => o.movements.create({
        execution: "own-fleet", origin, destination, cargoDescription: "HARNESS permissions priced", sell: { total: 10, currency: "MZN" },
    } as never))) === "NOT_ALLOWED");

    const opsDetail = await o.movements.get({ id: order.id });
    check("Operações' buttons: rig yes, prices no, payment no, status yes",
        opsDetail.permissions.editable.includes("rig") && !opsDetail.permissions.editable.includes("buy")
        && !opsDetail.permissions.canRecordPayment && opsDetail.permissions.transitions.some((move) => move.to === "at-loading")
        && !opsDetail.permissions.canSendConfirmation, opsDetail.permissions);
    const procurementDetail = await p.movements.get({ id: order.id });
    check("Procurement's buttons: prices yes, rig no, no status moves on",
        procurementDetail.permissions.editable.includes("buy") && !procurementDetail.permissions.editable.includes("rig")
        && !procurementDetail.permissions.transitions.some((move) => move.to === "at-loading"), procurementDetail.permissions);

    // --- Changes count on the next request
    await change(operations.member, { kind: "grant", permission: "price:read" });
    check("a granted price:read shows Operações the price at once", (await o.movements.get({ id: order.id })).money.payable?.total === 1000);
    await revokeAll(operations.member);
    await change(operations.member, { kind: "grant", permission: "price:read", startsAt: new Date(Date.now() - 2 * HOUR), endsAt: new Date(Date.now() - HOUR) });
    check("a lapsed grant shows nothing", (await o.movements.get({ id: order.id })).money.payable === null);
    await change(operations.member, { kind: "grant", permission: "price:read", startsAt: new Date(Date.now() + HOUR), endsAt: new Date(Date.now() + 2 * HOUR) });
    check("a future grant shows nothing yet", (await o.movements.get({ id: order.id })).money.payable === null);
    await revokeAll(operations.member);

    await change(gestor.member, { kind: "remove", permission: "finance:read" });
    check("a Gestor without finance:read loses the margin", (await g.movements.get({ id: order.id })).money.margin === null);
    await revokeAll(gestor.member);

    await change(operations.member, { kind: "acting_owner", endsAt: new Date(Date.now() + HOUR) });
    check("an acting CEO exports", (await refusal(() => o.movements.export(exportInput as never))) === null);
    const actingSession = await o.me.session();
    check("the session says acting CEO at level 3", actingSession.actingOwner && actingSession.level === 3);
    await revokeAll(operations.member);
    check("once revoked, the lift is gone", (await refusal(() => o.movements.export(exportInput as never))) === "NOT_ALLOWED");

    await teamChecks({ ceo, g, p, o, gestor, procurement, operations });
}

type People = {
    ceo: ReturnType<typeof as>;
    g: ReturnType<typeof as>;
    p: ReturnType<typeof as>;
    o: ReturnType<typeof as>;
    gestor: { user: string; member: string };
    procurement: { user: string; member: string };
    operations: { user: string; member: string };
};

/** The team router's rules: level, ceiling, nobody edits themselves, the acting CEO. */
async function teamChecks({ ceo, g, p, o, gestor, procurement, operations }: People) {
    const [ceoMember] = await db.select({ id: member.id }).from(member).where(eq(member.userId, A.user));
    const soon = new Date(Date.now() + HOUR);

    // Who may edit whom
    const asGestor = await g.team.members();
    check("a Gestor may edit Procurement and Operações", asGestor.find((row) => row.id === procurement.member)?.editable === true
        && asGestor.find((row) => row.id === operations.member)?.editable === true);
    check("…but not the CEO, nor itself", asGestor.find((row) => row.id === ceoMember!.id)?.editable === false
        && asGestor.find((row) => row.id === gestor.member)?.editable === false);
    check("Operações reads its own permissions", (await refusal(() => o.team.permissions.get({ memberId: operations.member }))) === null);
    check("Operações cannot read anybody else's", (await refusal(() => o.team.permissions.get({ memberId: procurement.member }))) === "NOT_ALLOWED");
    check("Operações cannot change anybody's permissions", (await refusal(() => o.team.permissions.set({ memberId: procurement.member, permission: "dispatch:assign", on: true }))) === "NOT_ALLOWED");

    // A Gestor over the level below
    check("a Gestor switches a permission on for Operações", (await refusal(() => g.team.permissions.set({ memberId: operations.member, permission: "price:read", on: true }))) === null);
    check("…and it counts on Operações' next request", (await o.me.session()).permissions.includes("price:read"));
    check("a Gestor switches it back to the profile default", (await refusal(() => g.team.permissions.set({ memberId: operations.member, permission: "price:read", on: false }))) === null
        && !(await o.me.session()).permissions.includes("price:read"));
    check("a Gestor cannot edit itself", (await refusal(() => g.team.permissions.set({ memberId: gestor.member, permission: "security:manage", on: true }))) === "NOT_ALLOWED");
    check("a Gestor cannot edit the CEO", (await refusal(() => g.team.permissions.set({ memberId: ceoMember!.id, permission: "price:read", on: false }))) === "NOT_ALLOWED");
    check("a Gestor cannot hand out what it does not hold", (await refusal(() => g.team.permissions.set({ memberId: operations.member, permission: "security:manage", on: true }))) === "NOT_ALLOWED");
    check("a Gestor cannot promote anybody to Gestor", (await refusal(() => g.team.changeProfile({ memberId: operations.member, profile: "admin" }))) === "NOT_ALLOWED");
    check("a Gestor cannot act on another Gestor", (await refusal(async () => {
        const other = await person("admin");
        return g.team.permissions.set({ memberId: other.member, permission: "export:csv", on: false });
    })) === "NOT_ALLOWED");

    // The CEO's removal closes the ceiling for the Gestor too
    check("the CEO takes finance:read from the Gestor", (await refusal(() => ceo.team.permissions.set({ memberId: gestor.member, permission: "finance:read", on: false }))) === null);
    check("…and the Gestor can no longer give it to anybody", (await refusal(() => g.team.permissions.set({ memberId: procurement.member, permission: "finance:read", on: true }))) === "NOT_ALLOWED");
    check("a temporary grant with a window", (await refusal(() => ceo.team.permissions.set({ memberId: procurement.member, permission: "finance:read", on: true, endsAt: soon }))) === null
        && (await p.me.session()).permissions.includes("finance:read"));
    check("a window that already closed is refused", (await refusal(() => ceo.team.permissions.set({ memberId: procurement.member, permission: "export:csv", on: true, endsAt: new Date(Date.now() - HOUR) }))) === "INVALID_WINDOW");
    const sheet = await ceo.team.permissions.get({ memberId: procurement.member });
    check("the sheet shows the temporary change with its end", sheet.changes.some((row) => row.permission === "finance:read" && row.kind === "grant" && row.endsAt !== null && row.live));

    // A profile change starts over
    check("the CEO changes Procurement to Operações", (await refusal(() => ceo.team.changeProfile({ memberId: procurement.member, profile: "operations" }))) === null);
    const changed = await p.me.session();
    check("…which resets to the new profile's defaults", changed.role === "operations" && !changed.permissions.includes("finance:read") && !changed.permissions.includes("price:read"));
    await ceo.team.changeProfile({ memberId: procurement.member, profile: "procurement" });

    // The acting CEO
    check("a Gestor cannot name an acting CEO", (await refusal(() => g.team.actingOwner.grant({ memberId: operations.member, endsAt: soon }))) === "NOT_ALLOWED");
    check("the CEO names the Gestor acting CEO for an hour", (await refusal(() => ceo.team.actingOwner.grant({ memberId: gestor.member, endsAt: soon }))) === null);
    check("the acting CEO edits another manager", (await refusal(async () => {
        const other = await person("admin");
        return g.team.permissions.set({ memberId: other.member, permission: "export:csv", on: false });
    })) === null);
    check("…but still never itself", (await refusal(() => g.team.permissions.set({ memberId: gestor.member, permission: "export:csv", on: false }))) === "NOT_ALLOWED");
    check("…nor names another acting CEO", (await refusal(() => g.team.actingOwner.grant({ memberId: operations.member, endsAt: soon }))) === "NOT_ALLOWED");
    check("…nor touches the CEO", (await refusal(() => g.team.permissions.set({ memberId: ceoMember!.id, permission: "price:read", on: false }))) === "NOT_ALLOWED");
    const window = (await ceo.team.permissions.get({ memberId: gestor.member })).actingWindow;
    check("the CEO ends the window early", window !== null && (await refusal(() => ceo.team.actingOwner.revoke({ id: window!.id }))) === null);
    check("…and the Gestor is a Gestor again", (await refusal(async () => {
        const other = await person("admin");
        return g.team.permissions.set({ memberId: other.member, permission: "export:csv", on: false });
    })) === "NOT_ALLOWED");

    // Removing people
    check("Operações cannot remove anybody", (await refusal(() => o.team.remove({ memberId: procurement.member }))) === "NOT_ALLOWED");
    check("nobody removes the CEO", (await refusal(() => g.team.remove({ memberId: ceoMember!.id }))) === "NOT_ALLOWED");
    const leaving = await person("operations");
    check("a Gestor removes an Operações", (await refusal(() => g.team.remove({ memberId: leaving.member }))) === null);
    check("…who is out of the portal at once", (await refusal(() => as(leaving.user).me.session())) === "NO_ORGANIZATION");
}

async function cleanup() {
    await Promise.allSettled(logged);
    // Anything an earlier, crashed run left behind goes too
    const leftovers = await db.select({ id: movement.id }).from(movement)
        .where(and(eq(movement.organizationId, A.org), like(movement.cargoDescription, "HARNESS permissions%")));
    const movements = [...new Set([...movementsHere, ...leftovers.map((row) => row.id)])];
    if (movements.length > 0) {
        await db.delete(notification).where(and(eq(notification.entityType, "movement"), inArray(notification.entityId, movements)));
        await db.delete(movementEvent).where(inArray(movementEvent.movementId, movements));
        await db.delete(movement).where(inArray(movement.id, movements));
    }
    // Members first; their permission rows cascade with them
    await db.delete(member).where(like(member.userId, "harness-perm-%"));
    await db.delete(user).where(like(user.id, "harness-perm-%"));
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
