/**
 * End-to-end check of the movements router: drives it directly as three real
 * companies on the SHARED DEV DATABASE — the portal test tenants (a shipper, a
 * carrier with an owner and a member, and a stranger) — with an explicit
 * tenant context per call. Nobody is signed in; the tenant gate still
 * resolves membership live, exactly as it does behind the HTTP handler.
 *
 * It walks one load through its whole life — filed, offered, accepted,
 * started, delivered, paid and closed — and checks every privacy boundary on
 * the way: what each company's payload carries and, as importantly, what it
 * does not. Every row it writes is deleted at the end, pass or fail.
 *
 * Run from apps/app (the react-server condition turns `server-only` into the
 * no-op it is inside a server render):
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/verify-movements.ts
 */
import fs from "node:fs";

import { and, count, eq, inArray } from "drizzle-orm";

import { db } from "@workspace/db/db";
import {
    movement,
    movementCost,
    movementDocument,
    movementEvent,
    movementLocation,
    movementRoute,
    movementTrackingRequest,
} from "@workspace/db/movements";
import { notification } from "@workspace/db/notifications";
import { subscriptionUsage } from "@workspace/db/subscriptions";
import { activityLog } from "@workspace/db/activity-log";
import { member } from "@workspace/db/users";
import { ownerTargets } from "@workspace/domain/movements/status";
import { normalizePhone } from "@workspace/comms/phone";
import { resolveMovementForConversation } from "@workspace/domain/tracking/movements";
import { getStaffGates } from "@workspace/trpc/staff-gate";
import { getTenantGates } from "@workspace/trpc/tenant-gate";
import { createCallerFactory } from "@workspace/trpc/init";

import { analyticsRouter } from "@/frontend/pages/analytics/server/procedures";
import { mapRouter } from "@/frontend/pages/map/server/procedures";
import { movementsRouter } from "@/frontend/pages/movements/server/procedures";
import { meRouter } from "@/frontend/pages/settings/server/procedures";

process.env.DATABASE_URL ??= fs.readFileSync("../admin/.env", "utf8").match(/^DATABASE_URL=(.+)$/m)![1]!.trim();

const SESSION_ID = "verify-movements";
const createCaller = createCallerFactory(movementsRouter);
const createAnalyticsCaller = createCallerFactory(analyticsRouter);
const createMapCaller = createCallerFactory(mapRouter);
const createMeCaller = createCallerFactory(meRouter);

const contextFor = (userId: string) => ({
    authApi: undefined as never,
    session: { user: { id: userId, name: "harness" }, session: { id: SESSION_ID, userId } } as never,
    db,
    app: "portal" as const,
    headers: new Headers(),
    waitUntil: undefined,
    staffGates: (id: string) => getStaffGates(db, { userId: id }),
    tenantGates: (id: string) => getTenantGates(db, { userId: id }),
});

/** The map and the rail read the same rows through their own doors. */
const mapFor = (userId: string) => createMapCaller(contextFor(userId));
const analyticsFor = (userId: string) => createAnalyticsCaller(contextFor(userId));

/** One currency of a company's own-loads report, zero when it has none. */
const loadsLine = async (userId: string, currency: string) => {
    const report = await analyticsFor(userId).loads({});
    const line = report.byCurrency.find((entry) => entry.currency === currency);
    return {
        comparable: report.comparable,
        gross: line?.margin.gross ?? 0,
        net: line?.margin.net ?? 0,
        paid: line?.payable.settled ?? 0,
        costs: line?.costs.total ?? 0,
    };
};
const meFor = (userId: string) => createMeCaller(contextFor(userId));

const as = (userId: string) =>
    createCaller({
        authApi: undefined as never,
        session: { user: { id: userId, name: "harness" }, session: { id: SESSION_ID, userId } } as never,
        db,
        app: "portal",
        headers: new Headers(),
        waitUntil: undefined,
        staffGates: (id: string) => getStaffGates(db, { userId: id }),
        tenantGates: (id: string) => getTenantGates(db, { userId: id }),
    });

const A = { user: "FT7QysKKfs5NKuut5i2S8Nhg6ItrwyuR", org: "42655a3f-0bd5-4e46-af29-9c5ee342a8aa" }; // shipper
const B = { user: "a2R9UNA2NTiEo3FS7DxlwgBFUn8EDNU6", org: "9b7674e5-ea7b-416b-a199-6ca6842da718" }; // carrier, owner
const BM = { user: "AM6u6fxppa9LEkRiMnMDHyrMpThmNrQy", org: B.org }; // carrier, member
const C = { user: "kU9US5NBPjNtS5HsSQBW3ZfEZvj7GQSm", org: "49db92eb-c131-467e-8bfc-fe42a7dcc149" }; // stranger

const origin = { state: "Nampula Province", address: "Nampula, Mozambique", country: "Mozambique", placeId: "ChIJOaE2a7M1xhgRdN3KTEt2F8I" };
const destination = { state: "Gauteng", address: "Johannesburg, South Africa", country: "South Africa", placeId: "ChIJUWpA8GgMlR4RQUDTsdnJiiM" };

const results: { name: string; ok: boolean; detail?: string }[] = [];

function check(name: string, ok: boolean, detail?: unknown) {
    results.push({ name, ok, detail: ok ? undefined : JSON.stringify(detail) });
    console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : ` — ${JSON.stringify(detail)}`}`);
}

async function expectError(name: string, run: () => Promise<unknown>, message: string) {
    try {
        await run();
        check(name, false, "no error thrown");
    } catch (error) {
        const got = (error as { message?: string }).message;
        check(name, got === message, { expected: message, got });
    }
}

const created: string[] = [];

async function cleanup() {
    if (created.length === 0) return;

    await db.delete(notification).where(and(eq(notification.entityType, "movement"), inArray(notification.entityId, created)));
    await db.delete(subscriptionUsage).where(and(eq(subscriptionUsage.entityType, "movement"), inArray(subscriptionUsage.entityId, created)));
    await db.delete(activityLog).where(eq(activityLog.sessionId, SESSION_ID));
    for (const table of [movementEvent, movementCost, movementDocument, movementLocation, movementTrackingRequest, movementRoute]) {
        await db.delete(table).where(inArray(table.movementId, created));
    }
    await db.update(movement).set({ executionMovementId: null }).where(inArray(movement.id, created));
    await db.delete(movement).where(inArray(movement.id, created));
    console.log(`\ncleaned up ${created.length} movements and everything hanging off them`);
}

async function main() {
    const a = as(A.user);
    const b = as(B.user);

    console.log("\n— A (shipper) files an order with B (carrier on the portal)");
    const filed = await a.create({
        execution: "partner",
        carrierOrgId: B.org,
        origin,
        destination,
        cargoDescription: "HARNESS maize, 30t",
        buy: { total: 50000, currency: "MZN", fiscalRegime: "normal" },
    });
    created.push(filed.id);
    check("A's load is an order (ORD-)", filed.ref.startsWith("ORD-"), filed);

    let aDetail = await a.get({ id: filed.id });
    check("A is the owner", aDetail.role === "owner", aDetail.role);
    check("A's payable is the 50 000 MZN it agreed", aDetail.money.payable?.total === 50000 && aDetail.money.payable.currency === "MZN", aDetail.money.payable);
    check("A has nothing receivable — a shipper is the end client", aDetail.money.receivable === null, aDetail.money.receivable);
    check("A's margin is blocked: no sell leg", aDetail.money.margin?.blocked === "MISSING_LEG", aDetail.money.margin);
    check("A may offer it", aDetail.permissions.canOffer, aDetail.permissions);
    check("A is not offered 'scheduled' — B is asked, never assumed", !aDetail.permissions.transitions.some((t) => t.to === "scheduled"), aDetail.permissions.transitions);

    await expectError("scheduling it directly is refused by the door too", () =>
        a.transition({ id: filed.id, to: "scheduled", expectedVersion: aDetail.version }), "INVALID_STATUS");

    console.log("\n— A offers it");
    const offered = await a.offer({ id: filed.id, expectedVersion: aDetail.version, message: "HARNESS please confirm by Friday" });

    const inbox = await b.list({ scope: "orders", section: "inbox" });
    const inboxRow = inbox.items.find((row) => row.id === filed.id);
    check("it lands in B's inbox", Boolean(inboxRow), inbox.items.map((row) => row.ref));
    check("…where B is the executor", inboxRow?.role === "executor", inboxRow?.role);
    check("…and sees who is asking", inboxRow?.owner?.id === A.org, inboxRow?.owner);
    check("…but not A's client nor any carrier", inboxRow?.client === null && inboxRow?.carrier === null, inboxRow);
    check("…and only what it would be paid", inboxRow?.receivable?.total === 50000 && inboxRow?.payable === null, inboxRow);

    const bView = await b.get({ id: filed.id });
    const bJson = JSON.stringify(bView);
    check("B's payload has no sell* key at all", !/"sell[A-Z]/.test(bJson));
    check("B's payload has no phone, notes or client reference", bView.driverPhone === null && bView.notes === null && bView.clientReference === null, bView);
    check("B reads A's message on the offer", bView.events.some((event) => event.kind === "offer" && event.note === "HARNESS please confirm by Friday"), bView.events);
    check("B is offered the answer", bView.permissions.canRespond, bView.permissions);

    await expectError("a stranger gets a 404, not a 403", () => as(C.user).get({ id: filed.id }), "NOT_FOUND");
    await expectError("B's plain member cannot commit the company", () =>
        as(BM.user).respond({ id: filed.id, expectedVersion: offered.version, decision: "accept" }), "NOT_ALLOWED");
    await expectError("an answer to a stale version conflicts", () =>
        b.respond({ id: filed.id, expectedVersion: offered.version - 1, decision: "accept" }), "VERSION_CONFLICT");

    console.log("\n— B accepts");
    const accepted = await b.respond({ id: filed.id, expectedVersion: offered.version, decision: "accept" });
    created.push(accepted.id);
    check("B gets a trip of its own (TRP-)", accepted.ref?.startsWith("TRP-") ?? false, accepted);

    await expectError("accepting twice finds the offer taken", () =>
        b.respond({ id: filed.id, expectedVersion: offered.version, decision: "accept" }), "NOT_FOUND");

    aDetail = await a.get({ id: filed.id });
    check("A's order is booked", aDetail.status === "scheduled", aDetail.status);
    check("A's order is linked to B's truck", aDetail.isLinked);
    check("A's agreed terms froze", !aDetail.permissions.editable.includes("details") && !aDetail.permissions.editable.includes("buy"), aDetail.permissions.editable);

    let bOwn = await b.get({ id: accepted.id });
    check("B owns its row", bOwn.role === "owner", bOwn.role);
    check("B's row is its own fleet, scheduled", bOwn.execution === "own-fleet" && bOwn.status === "scheduled", bOwn);
    check("B's client is A", bOwn.client?.id === A.org, bOwn.client);
    check("B's receivable is A's price", bOwn.money.receivable?.total === 50000, bOwn.money.receivable);
    check("B's row carries A's reference", bOwn.clientReference === filed.ref, bOwn.clientReference);
    check("B's row knows it is somebody's order", bOwn.hasParent);
    check("B cannot change the agreed price", !bOwn.permissions.editable.includes("sellAmounts"), bOwn.permissions.editable);

    const aOnB = await a.get({ id: accepted.id });
    check("A can read B's row — as its client", aOnB.role === "client", aOnB.role);
    check("…with no carrier, phone or costs", aOnB.carrier === null && aOnB.driverPhone === null && aOnB.costs.length === 0, aOnB);
    check("…and no buy* key at all", !/"buy[A-Z]/.test(JSON.stringify(aOnB)));

    const aOrders = await a.list({ scope: "orders", section: "all" });
    check("A's orders list shows its order", aOrders.items.some((row) => row.id === filed.id));
    check("…and does not repeat B's row beside it", !aOrders.items.some((row) => row.id === accepted.id), aOrders.items.map((row) => row.ref));

    await expectError("A cannot move the destination after acceptance", () =>
        a.update({ id: filed.id, expectedVersion: aDetail.version, destination: origin }), "FIELD_LOCKED");

    console.log("\n— B names its driver and the truck leaves");
    const phone = "+258840000999";
    const named = await b.update({ id: accepted.id, expectedVersion: bOwn.version, driverName: "HARNESS Driver", driverPhone: phone, truckPlate: "HAR-001-MP" });
    await b.transition({ id: accepted.id, to: "in-transit", expectedVersion: named.version });

    aDetail = await a.get({ id: filed.id });
    check("A's order followed B's truck into transit", aDetail.status === "in-transit", aDetail.status);
    check("…with a trail line that says it was carried up", aDetail.events.some((event) => event.kind === "system" && event.toStatus === "in-transit"), aDetail.events);
    check("…and still no phone of B's driver", aDetail.driverPhone === null);
    check("…but it knows which truck is coming", aDetail.driverName === "HARNESS Driver" && aDetail.truckPlate === "HAR-001-MP", { driver: aDetail.driverName, plate: aDetail.truckPlate });

    const aOrderRows = await a.list({ scope: "orders", section: "in-transit" });
    const aOrderRow = aOrderRows.items.find((row) => row.id === filed.id);
    check("…in its list too", aOrderRow?.truckPlate === "HAR-001-MP", aOrderRow);

    const usage = await db
        .select({ org: subscriptionUsage.organizationId, entity: subscriptionUsage.entityId })
        .from(subscriptionUsage)
        .where(and(eq(subscriptionUsage.entityType, "movement"), inArray(subscriptionUsage.entityId, created)));
    check("each company is billed once, for its own row", usage.length === 2
        && usage.some((row) => row.org === A.org && row.entity === filed.id)
        && usage.some((row) => row.org === B.org && row.entity === accepted.id), usage);

    console.log("\n— the silent failure: both rows carry the driver's phone");
    // The case the fix exists for: A typed this phone while the partner was
    // off the platform, then the partner joined and took the load
    await db.update(movement).set({ driverPhone: phone }).where(eq(movement.id, filed.id));
    const pinOwner = await resolveMovementForConversation(db, { conversationId: "harness-no-thread", driverPhone: normalizePhone(phone) });
    check("a pin on that phone lands on B's row, not nowhere", pinOwner?.id === accepted.id, pinOwner);
    await db.update(movement).set({ driverPhone: null }).where(eq(movement.id, filed.id));

    console.log("\n— the proof of delivery travels up");
    await b.documents.add({ movementId: accepted.id, type: "pod", url: "https://files.edgestore.dev/harness/pod.pdf", title: "HARNESS POD" });
    await b.documents.add({ movementId: accepted.id, type: "invoice", leg: "sell", url: "https://files.edgestore.dev/harness/invoice.pdf", title: "HARNESS B invoice" });
    aDetail = await a.get({ id: filed.id });
    const pod = aDetail.documents.find((document) => document.title === "HARNESS POD");
    check("B's POD shows on A's order", Boolean(pod), aDetail.documents.map((document) => document.title));
    check("…without naming who at B uploaded it", pod?.uploadedByName === null, pod);
    check("…and B's own invoice to A does not ride up with it", !aDetail.documents.some((document) => document.title === "HARNESS B invoice"), aDetail.documents.map((document) => document.title));

    console.log("\n— delivery, money, and the books closing");
    const bReportBefore = await loadsLine(B.user, "MZN");
    const aReportBefore = await loadsLine(A.user, "MZN");
    bOwn = await b.get({ id: accepted.id });
    await b.transition({ id: accepted.id, to: "delivered", expectedVersion: bOwn.version });
    aDetail = await a.get({ id: filed.id });
    check("A's order was delivered with B's truck", aDetail.status === "delivered", aDetail.status);

    await expectError("A cannot close before paying", () =>
        a.transition({ id: filed.id, to: "closed", expectedVersion: aDetail.version }), "UNSETTLED");

    const halfPaid = await a.recordPayment({ id: filed.id, expectedVersion: aDetail.version, leg: "buy", amount: 20000, reference: "HARNESS-TRF-1" });
    aDetail = await a.get({ id: filed.id });
    check("a part payment makes the leg partial", aDetail.money.payable?.settlement === "partially" && aDetail.money.payable.settled === 20000, aDetail.money.payable);
    await a.recordPayment({ id: filed.id, expectedVersion: halfPaid.version, leg: "buy", amount: 30000 });
    aDetail = await a.get({ id: filed.id });
    check("the rest settles it", aDetail.money.payable?.settlement === "completed", aDetail.money.payable);
    await a.transition({ id: filed.id, to: "closed", expectedVersion: aDetail.version });
    aDetail = await a.get({ id: filed.id });
    check("A closes its books", aDetail.status === "closed", aDetail.status);

    bOwn = await b.get({ id: accepted.id });
    check("closing is each company's own: B's row is still delivered", bOwn.status === "delivered", bOwn.status);

    console.log("\n— B's margin, with a cost it absorbed and one it passes on");
    await b.costs.add({ movementId: accepted.id, kind: "fuel", amount: 12000, currency: "MZN" });
    await b.costs.add({ movementId: accepted.id, kind: "tolls", amount: 1500, currency: "MZN", rechargeable: true });
    await b.costs.add({ movementId: accepted.id, kind: "border-fees", amount: 800, currency: "ZAR" });
    bOwn = await b.get({ id: accepted.id });
    const m = bOwn.money.margin;
    check("gross is the sell leg on an own-fleet load", m?.gross?.amount === 50000, m);
    check("net drops only the absorbed MZN cost", m?.net?.amount === 38000, m);
    check("the ZAR cost is reported, never converted", m?.costs.some((cost) => cost.currency === "ZAR" && cost.total === 800) ?? false, m?.costs);

    const aAfter = await a.get({ id: accepted.id });
    check("A, as client, sees none of B's costs or margin", aAfter.costs.length === 0 && aAfter.money.margin === null, aAfter.money);

    console.log("\n— the year's report adds up to the load pages");
    const bReport = await loadsLine(B.user, "MZN");
    check("B's report gains this load's margin, as its page shows it", bReport.gross - bReportBefore.gross === 50000 && bReport.net - bReportBefore.net === 38000, { before: bReportBefore, after: bReport });
    check("…and counts it as comparable", bReport.comparable - bReportBefore.comparable === 1, { before: bReportBefore.comparable, after: bReport.comparable });
    check("…with both its MZN costs, rechargeable included", bReport.costs - bReportBefore.costs === 13500, { before: bReportBefore.costs, after: bReport.costs });
    const aReport = await loadsLine(A.user, "MZN");
    check("A's report counts what it paid B, and no margin — it sells nothing", aReport.paid - aReportBefore.paid === 50000 && aReport.gross === aReportBefore.gross, { before: aReportBefore, after: aReport });

    const bMoney = await b.recordPayment({ id: accepted.id, expectedVersion: bOwn.version, leg: "sell", amount: 50000 });
    await b.transition({ id: accepted.id, to: "closed", expectedVersion: bMoney.version });
    bOwn = await b.get({ id: accepted.id });
    check("B closes its own books once paid", bOwn.status === "closed", bOwn.status);
}

/**
 * The review's findings, each proven against the database rather than
 * asserted: that no list, map or count shows a partner's row twice or
 * lets its owner's client move it, the offer round an
 * executor may read, the probe a search could run, the role gates, what a
 * re-priced leg keeps, corrections, the atomic cancel, and one notification
 * per milestone rather than two.
 */
async function hardening() {
    const a = as(A.user);
    const b = as(B.user);
    const bMember = as(BM.user);

    console.log("\n— no list is a side door into the partner's row");
    const filed = await a.create({
        execution: "partner", carrierOrgId: B.org, origin, destination,
        cargoDescription: "HARNESS hardening", clientReference: "ACME-PO-7731",
        buy: { total: 58000, subtotal: 50000, vat: 8000, currency: "MZN", fiscalRegime: "normal" },
    });
    created.push(filed.id);

    let aDetail = await a.get({ id: filed.id });
    const offered = await a.offer({ id: filed.id, expectedVersion: aDetail.version });

    const railB = await meFor(B.user).railCounts();
    check("B's rail counts the offer in its inbox", railB.inbox >= 1, railB);

    const probe = await b.list({ scope: "orders", section: "inbox", search: "ACME-PO" });
    check("searching the inbox by A's client reference finds nothing", !probe.items.some((row) => row.id === filed.id), probe.items.map((row) => row.ref));

    const accepted = await b.respond({ id: filed.id, expectedVersion: offered.version, decision: "accept" });
    created.push(accepted.id);
    let bOwn = await b.get({ id: accepted.id });
    const named = await b.update({ id: accepted.id, expectedVersion: bOwn.version, driverName: "HARNESS Two", driverPhone: "+258840000998" });

    const aTrips = await a.list({ scope: "trips", section: "all" });
    const aOrders = await a.list({ scope: "orders", section: "all" });
    check("A's trips list does not show B's row", !aTrips.items.some((row) => row.id === accepted.id), aTrips.items.map((row) => row.ref));
    check("A's orders list shows the load once, as its own order", aOrders.items.filter((row) => row.id === accepted.id || row.id === filed.id).map((row) => row.id).join() === filed.id, aOrders.items.map((row) => row.ref));
    const aAsClient = await a.get({ id: accepted.id });
    check("A opening B's row by id reads it as the client, with no phone", aAsClient.role === "client" && aAsClient.driverPhone === null && aAsClient.money.receivable === null, { role: aAsClient.role, phone: aAsClient.driverPhone });
    await expectError("…and cannot move it", () => a.transition({ id: accepted.id, to: "in-transit", expectedVersion: named.version }), "NOT_FOUND");

    console.log("\n— one notification per milestone, not one per role");
    const before = await startedFor(A.org);
    await b.transition({ id: accepted.id, to: "in-transit", expectedVersion: named.version });
    const after = await startedFor(A.org);
    const members = await membersOf(A.org);
    check("A hears once that B's truck left", after - before === members, { before, after, members });

    console.log("\n— the map shows one truck, where the partner's driver is");
    const aPins = (await mapFor(A.user).overview()).filter((pin) => pin.kind === "load" && (pin.id === filed.id || pin.id === accepted.id));
    check("A's map has the load once, as its own order", aPins.length === 1 && aPins[0]!.id === filed.id, aPins.map((pin) => pin.ref));
    check("…carrying B's driver and plate, not B's phone", aPins[0]?.driverName === "HARNESS Two" && !JSON.stringify(aPins[0]).includes("+258840000998"), aPins[0]);
    const bPins = (await mapFor(B.user).overview()).filter((pin) => pin.kind === "load" && (pin.id === filed.id || pin.id === accepted.id));
    check("B's map has it once, as its own trip", bPins.length === 1 && bPins[0]!.id === accepted.id, bPins.map((pin) => pin.ref));

    console.log("\n— margin is earnings, not VAT");
    bOwn = await b.get({ id: accepted.id });
    check("B's gross is the ex-VAT price", bOwn.money.margin?.gross?.amount === 50000, bOwn.money.margin);

    console.log("\n— cancelling a linked order takes the executor's row with it, or nothing");
    const second = await a.create({
        execution: "partner", carrierOrgId: B.org, origin, destination, cargoDescription: "HARNESS cancel",
        buy: { total: 1000, currency: "MZN" },
    });
    created.push(second.id);
    aDetail = await a.get({ id: second.id });
    const secondOffer = await a.offer({ id: second.id, expectedVersion: aDetail.version });
    const secondAccept = await b.respond({ id: second.id, expectedVersion: secondOffer.version, decision: "accept" });
    created.push(secondAccept.id);

    // The race the fix closes: B's truck leaves between A's read and A's
    // write. Staged directly, since two requests cannot be timed from here
    await db.update(movement).set({ status: "in-transit" }).where(eq(movement.id, secondAccept.id));
    aDetail = await a.get({ id: second.id });
    await expectError("A cannot cancel once B's truck has left", () =>
        a.transition({ id: second.id, to: "cancelled", expectedVersion: aDetail.version, note: "HARNESS" }), "EXECUTOR_DEPARTED");
    const [stillA] = await db.select({ status: movement.status }).from(movement).where(eq(movement.id, second.id));
    check("…and A's order was left untouched", stillA?.status === "scheduled", stillA);
    await db.update(movement).set({ status: "scheduled" }).where(eq(movement.id, secondAccept.id));

    aDetail = await a.get({ id: second.id });
    await a.transition({ id: second.id, to: "cancelled", expectedVersion: aDetail.version, note: "HARNESS client changed plans" });
    const [bothA] = await db.select({ status: movement.status }).from(movement).where(eq(movement.id, second.id));
    const [bothB] = await db.select({ status: movement.status }).from(movement).where(eq(movement.id, secondAccept.id));
    check("otherwise both rows are cancelled together", bothA?.status === "cancelled" && bothB?.status === "cancelled", { bothA, bothB });

    console.log("\n— an executor reads its own offer round, and nothing before it");
    const third = await a.create({
        execution: "partner", carrierOrgId: B.org, origin, destination, cargoDescription: "HARNESS rounds",
        buy: { total: 2000, currency: "MZN" },
    });
    created.push(third.id);
    aDetail = await a.get({ id: third.id });
    let round = await a.offer({ id: third.id, expectedVersion: aDetail.version, message: "HARNESS first round" });
    const declined = await b.respond({ id: third.id, expectedVersion: round.version, decision: "decline", note: "HARNESS need 1400" });
    void declined;
    aDetail = await a.get({ id: third.id });
    round = await a.offer({ id: third.id, expectedVersion: aDetail.version, message: "HARNESS second round" });
    const reread = await b.get({ id: third.id });
    const notes = reread.events.map((event) => event.note).filter(Boolean);
    check("B sees the second offer's message", notes.includes("HARNESS second round"), notes);
    check("…but not the first round, nor its own earlier answer", !notes.includes("HARNESS first round") && !notes.includes("HARNESS need 1400"), notes);

    console.log("\n— a different partner starts a different deal");
    aDetail = await a.get({ id: third.id });
    const withdrawn = await a.withdraw({ id: third.id, expectedVersion: aDetail.version });
    await a.update({ id: third.id, expectedVersion: withdrawn.version, carrierName: "HARNESS Off-Platform Lda" });
    const swapped = await a.get({ id: third.id });
    check("swapping the carrier clears the last offer's answer", swapped.responseNote === null && swapped.respondedAt === null && swapped.offeredAt === null, swapped);
    await expectError("B can no longer open it", () => b.get({ id: third.id }), "NOT_FOUND");

    console.log("\n— the role gates on partner loads");
    const bPartner = await b.create({
        execution: "partner", carrierName: "HARNESS Subcontractor", origin, destination, cargoDescription: "HARNESS roles",
        buy: { total: 3000, currency: "MZN" },
    });
    created.push(bPartner.id);
    let bp = await b.get({ id: bPartner.id });
    await expectError("B's member cannot place it (schedule an off-platform partner)", () =>
        bMember.transition({ id: bPartner.id, to: "scheduled", expectedVersion: bp.version }), "NOT_ALLOWED");
    await expectError("B's member cannot cancel it", () =>
        bMember.transition({ id: bPartner.id, to: "cancelled", expectedVersion: bp.version }), "NOT_ALLOWED");
    const bpMember = await bMember.get({ id: bPartner.id });
    check("…and is not offered either button", !bpMember.permissions.transitions.some((t) => t.to === "scheduled" || t.to === "cancelled"), bpMember.permissions.transitions);

    console.log("\n— what a re-priced leg keeps, and how a mistake is corrected");
    bp = await b.get({ id: bPartner.id });
    const paid = await b.recordPayment({ id: bPartner.id, expectedVersion: bp.version, leg: "buy", amount: 3000 });
    const repriced = await b.update({ id: bPartner.id, expectedVersion: paid.version, buy: { total: 3000, subtotal: 3000, vat: 0, currency: "MZN" } });
    bp = await b.get({ id: bPartner.id });
    check("re-splitting a paid leg keeps it settled", bp.money.payable?.settlement === "completed" && bp.money.payable.settled === 3000, bp.money.payable);
    await expectError("moving a paid leg to another currency is refused", () =>
        b.update({ id: bPartner.id, expectedVersion: repriced.version, buy: { total: 150, currency: "USD" } }), "LEG_HAS_PAYMENTS");
    await expectError("so is converting it back in-house", () =>
        b.convert({ id: bPartner.id, expectedVersion: repriced.version, to: "own-fleet" }), "LEG_HAS_PAYMENTS");
    await expectError("a correction needs a reference", () =>
        b.recordPayment({ id: bPartner.id, expectedVersion: repriced.version, leg: "buy", amount: -500 }), "CORRECTION_NEEDS_REFERENCE");
    await expectError("and cannot take the leg below zero", () =>
        b.recordPayment({ id: bPartner.id, expectedVersion: repriced.version, leg: "buy", amount: -4000, reference: "HARNESS typo" }), "PAYMENT_BELOW_ZERO");
    await b.recordPayment({ id: bPartner.id, expectedVersion: repriced.version, leg: "buy", amount: -500, reference: "HARNESS typed 3000, paid 2500" });
    bp = await b.get({ id: bPartner.id });
    check("a correction brings the leg back to partial", bp.money.payable?.settled === 2500 && bp.money.payable.settlement === "partially", bp.money.payable);

    console.log("\n— closed books stay closed");
    const own = await b.create({ execution: "own-fleet", origin, destination, cargoDescription: "HARNESS closed", driverName: "HARNESS Three", driverPhone: "+258840000997", status: "scheduled" });
    created.push(own.id);
    const cost = await b.costs.add({ movementId: own.id, kind: "fuel", amount: 100, currency: "MZN" });
    let o = await b.get({ id: own.id });
    const cancelled = await b.transition({ id: own.id, to: "cancelled", expectedVersion: o.version, note: "HARNESS" });
    void cancelled;
    await expectError("a cost line cannot be taken off a cancelled load", () => b.costs.remove({ id: cost.id }), "MOVEMENT_CLOSED");

    console.log("\n— a partner that joined after its load left keeps the load's lifecycle");
    const late = ownerTargets({ execution: "partner", status: "in-transit", linked: false, executorOnPortal: true });
    check("the owner can still deliver or call it off", late.includes("delivered") && late.includes("cancelled"), late);
    o = await b.get({ id: own.id });
    void o;
}

/** One notification row goes to each member of a company. */
async function membersOf(organizationId: string): Promise<number> {
    const [row] = await db.select({ value: count() }).from(member).where(eq(member.organizationId, organizationId));
    return row?.value ?? 0;
}

/** How many "your truck left" notifications a company has had. */
async function startedFor(organizationId: string): Promise<number> {
    const [row] = await db
        .select({ value: count() })
        .from(notification)
        .where(and(eq(notification.organizationId, organizationId), eq(notification.kind, "movement.started")));
    return row?.value ?? 0;
}

main()
    .then(hardening)
    .catch((error) => {
        console.error("\nharness crashed:", error);
        results.push({ name: "harness ran to the end", ok: false, detail: String(error) });
    })
    .finally(async () => {
        await cleanup().catch((error) => console.error("cleanup failed:", error));
        const failed = results.filter((result) => !result.ok);
        console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
        process.exit(failed.length === 0 ? 0 : 1);
    });


