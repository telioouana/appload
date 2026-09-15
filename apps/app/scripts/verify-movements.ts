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
 * does not. Then the menu's own rules, each group titled with its number in
 * the contract (§11): the truck's chain and its stamps, the role gate, the
 * allowance, propagation, tracking, the sections and their tabs, disputes and
 * the partner lists. Every row it writes is deleted at the end, pass or fail.
 *
 * Run from apps/app (the react-server condition turns `server-only` into the
 * no-op it is inside a server render; tsx is not a dependency):
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/verify-movements.ts
 */
import fs from "node:fs";

import { and, count, desc, eq, inArray, sql } from "drizzle-orm";

import { chatConversation, chatMessage, type TrackingStatus } from "@workspace/db/chats";
import { partnerConnection } from "@workspace/db/connections";
import { db } from "@workspace/db/db";
import {
    MOVEMENT_STATUS,
    movement,
    movementCost,
    movementDispute,
    movementDisputeRow,
    movementDocument,
    movementEvent,
    movementLocation,
    movementRoute,
    movementTrackingAlert,
    movementTrackingRequest,
    type MovementStatus,
} from "@workspace/db/movements";
import { notification, type NotificationKind } from "@workspace/db/notifications";
import { subscriptionUsage } from "@workspace/db/subscriptions";
import { activityLog } from "@workspace/db/activity-log";
import { member, organization } from "@workspace/db/users";
import { ownerTargets } from "@workspace/domain/movements/status";
import { periodKey, trackingAllowance } from "@workspace/domain/subscription";
import { normalizePhone } from "@workspace/comms/phone";
import { reviewMovementSlot } from "@workspace/domain/tracking/movement-review";
import { resolveMovementForConversation } from "@workspace/domain/tracking/movements";
import { MAPUTO_OFFSET_MS, MAX_ATTEMPTS, channelFor, slotStart, type SlotInfo } from "@workspace/domain/tracking/slot";
import { getStaffGates } from "@workspace/trpc/staff-gate";
import { getTenantGates } from "@workspace/trpc/tenant-gate";
import { createCallerFactory } from "@workspace/trpc/init";

import { analyticsRouter } from "@/frontend/pages/analytics/server/procedures";
import { mapRouter } from "@/frontend/pages/map/server/procedures";
import { movementsRouter } from "@/frontend/pages/movements/server/procedures";
import {
    movementsListInput,
    movementTone,
    scopeOf,
    sectionOf,
    sectionsOf,
    STATUS_TABS,
} from "@/frontend/pages/movements/types";
import { partnersRouter } from "@/frontend/pages/partners/server/procedures";
import { countForKind, kindsFor, relationForKind } from "@/frontend/pages/partners/types";
import { searchRouter } from "@/frontend/pages/search/server/procedures";
import { meRouter } from "@/frontend/pages/settings/server/procedures";

process.env.DATABASE_URL ??= fs.readFileSync("../admin/.env", "utf8").match(/^DATABASE_URL=(.+)$/m)![1]!.trim();

const SESSION_ID = "verify-movements";
const createCaller = createCallerFactory(movementsRouter);
const createAnalyticsCaller = createCallerFactory(analyticsRouter);
const createMapCaller = createCallerFactory(mapRouter);
const createMeCaller = createCallerFactory(meRouter);
const createPartnersCaller = createCallerFactory(partnersRouter);
const createSearchCaller = createCallerFactory(searchRouter);

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
const partnersFor = (userId: string) => createPartnersCaller(contextFor(userId));
const searchFor = (userId: string) => createSearchCaller(contextFor(userId));

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

/** What refused a call that should have gone through, or null when nothing did. */
async function refusal(run: () => Promise<unknown>): Promise<string | null> {
    try {
        await run();
        return null;
    } catch (error) {
        return (error as { message?: string }).message ?? String(error);
    }
}

const created: string[] = [];
/** The chat rows the harness wrote itself, and only those, to delete again. */
const saidHere: string[] = [];
const threadsHere: string[] = [];
/** Usage rows written only to spend a company's month, never a load's. */
const spentHere: string[] = [];
/** Connection requests staged for the partner lists. */
const connectionsHere: string[] = [];

/**
 * The conversation and outbound message a location request leaves behind,
 * written straight to the tables so the check costs nothing at Infobip, and
 * the conversation stamped on the row that asked — the only link the thread
 * read trusts. A driver who already has a thread keeps it — only what this
 * run adds is cleaned up.
 */
async function simulateRequest(driverPhone: string, driverName: string, movementId: string): Promise<string> {
    const digits = normalizePhone(driverPhone);

    const [existing] = await db
        .select({ id: chatConversation.id })
        .from(chatConversation)
        .where(eq(chatConversation.driverPhone, digits))
        .limit(1);

    let conversationId = existing?.id;

    if (!conversationId) {
        const [opened] = await db
            .insert(chatConversation)
            .values({ driverName, driverPhone: digits })
            .returning({ id: chatConversation.id });

        conversationId = opened!.id;
        threadsHere.push(conversationId);
    }

    const [message] = await db
        .insert(chatMessage)
        .values({ conversationId, direction: "outbound", body: "HARNESS where are you now?", status: "sent" })
        .returning({ id: chatMessage.id });

    saidHere.push(message!.id);

    await db.update(movement).set({ conversationId }).where(eq(movement.id, movementId));

    return message!.id;
}

/**
 * The flags a load's move into one status was written with, comma-joined the
 * way the door wrote them — what the trail will have to answer for later.
 */
async function flagsOn(movementId: string, toStatus: MovementStatus): Promise<string | null> {
    const [row] = await db
        .select({ metadata: movementEvent.metadata })
        .from(movementEvent)
        .where(and(
            eq(movementEvent.movementId, movementId),
            eq(movementEvent.kind, "status"),
            eq(movementEvent.toStatus, toStatus),
        ))
        .orderBy(desc(movementEvent.createdAt))
        .limit(1);

    return (row?.metadata as { flags?: string } | null)?.flags ?? null;
}

/** What a move stamps, read off the row itself: the detail does not carry `resumeStatus`. */
async function stampsOf(movementId: string) {
    const [row] = await db
        .select({
            status: movement.status,
            startedAt: movement.startedAt,
            resumeStatus: movement.resumeStatus,
            deliveredAt: movement.deliveredAt,
            trackingEnabled: movement.trackingEnabled,
        })
        .from(movement)
        .where(eq(movement.id, movementId));

    return row!;
}

const HELD_UP: readonly MovementStatus[] = ["stopped", "issue"];

/**
 * Moves a row its owner holds through `steps`, one transition each, with a
 * reason on every interruption, and hands each step to `after` so a check can
 * watch what that move did on the way. Returns the row's last version.
 */
async function walk(
    caller: ReturnType<typeof as>,
    id: string,
    steps: readonly MovementStatus[],
    after?: (to: MovementStatus) => Promise<void>,
): Promise<number> {
    let { version } = await caller.get({ id });

    for (const to of steps) {
        ({ version } = await caller.transition({ id, to, expectedVersion: version, note: HELD_UP.includes(to) ? "HARNESS held up" : undefined }));
        await after?.(to);
    }

    return version;
}

/**
 * Spends what is left of a company's month with usage rows that bill no load,
 * so the allowance reads zero without touching its plan. Released again by the
 * check that needed it, and by the cleanup in case that check never got there.
 */
async function spendAllowance(organizationId: string): Promise<void> {
    const { remaining } = await trackingAllowance(db, organizationId);

    if (!remaining) return;

    const ids = Array.from({ length: remaining }, () => `harness-quota-${crypto.randomUUID()}`);

    await db.insert(subscriptionUsage).values(ids.map((entityId) => ({
        organizationId,
        period: periodKey(),
        entityType: "movement" as const,
        entityId,
    })));

    spentHere.push(...ids);
}

async function releaseAllowance(): Promise<void> {
    if (spentHere.length === 0) return;

    await db.delete(subscriptionUsage).where(inArray(subscriptionUsage.entityId, spentHere));
    spentHere.length = 0;
}

/**
 * The notifications of one kind on these rows that were not there the last
 * time this was asked with the same `seen`, which remembers them.
 */
async function noticesSince(kind: NotificationKind, entityIds: string[], seen: Set<string>) {
    const rows = await db
        .select({
            id: notification.id,
            organizationId: notification.organizationId,
            userId: notification.userId,
            entityId: notification.entityId,
            params: notification.params,
        })
        .from(notification)
        .where(and(eq(notification.kind, kind), inArray(notification.entityId, entityIds)));

    const fresh = rows.filter((row) => !seen.has(row.id));
    for (const row of fresh) seen.add(row.id);

    return fresh;
}

type Notice = Awaited<ReturnType<typeof noticesSince>>[number];

/** Every member of a company told once, on the one row given, with the name given. */
async function toldOnceOn(notices: readonly Notice[], organizationId: string, entityId: string, name: string): Promise<boolean> {
    const mine = notices.filter((notice) => notice.organizationId === organizationId);

    return mine.length === await membersOf(organizationId)
        && new Set(mine.map((notice) => notice.userId)).size === mine.length
        && mine.every((notice) => notice.entityId === entityId
            && (notice.params as { organizationName?: string }).organizationName === name);
}

async function cleanup() {
    await releaseAllowance();

    if (connectionsHere.length > 0) await db.delete(partnerConnection).where(inArray(partnerConnection.id, connectionsHere));
    if (saidHere.length > 0) await db.delete(chatMessage).where(inArray(chatMessage.id, saidHere));
    if (threadsHere.length > 0) await db.delete(chatConversation).where(inArray(chatConversation.id, threadsHere));

    if (created.length === 0) return;

    await db.delete(notification).where(and(eq(notification.entityType, "movement"), inArray(notification.entityId, created)));
    await db.delete(subscriptionUsage).where(and(eq(subscriptionUsage.entityType, "movement"), inArray(subscriptionUsage.entityId, created)));
    await db.delete(activityLog).where(eq(activityLog.sessionId, SESSION_ID));
    // A dispute's rows hold both the dispute and the movements, and the
    // dispute holds the row it was opened on: rows, then disputes, then loads
    await db.delete(movementDisputeRow).where(inArray(movementDisputeRow.movementId, created));
    await db.delete(movementDispute).where(inArray(movementDispute.movementId, created));
    for (const table of [movementEvent, movementCost, movementDocument, movementLocation, movementTrackingAlert, movementTrackingRequest, movementRoute]) {
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

    const planning = await b.list({ scope: "trips", section: "planning" });
    const offeredRow = planning.items.find((row) => row.id === filed.id);
    check("it lands in B's Trips ▸ Planning", Boolean(offeredRow), planning.items.map((row) => row.ref));
    check("…where B is the executor", offeredRow?.role === "executor", offeredRow?.role);
    check("…and sees who is asking", offeredRow?.owner?.id === A.org, offeredRow?.owner);
    check("…but not A's client nor any carrier", offeredRow?.client === null && offeredRow?.carrier === null, offeredRow);
    check("…and only what it would be paid", offeredRow?.receivable?.total === 50000 && offeredRow?.payable === null, offeredRow);

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
    check("A's order is confirmed", aDetail.status === "scheduled", aDetail.status);
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

    console.log("\n— B books the load before it has a rig: flagged, never blocked");
    const aConfirmed = await a.list({ scope: "orders", section: "procurement", status: "scheduled" });
    check("A's order waits in Procurement ▸ Confirmed", aConfirmed.items.some((row) => row.id === filed.id), aConfirmed.items.map((row) => row.ref));

    bOwn = await b.get({ id: accepted.id });
    const booking = bOwn.permissions.transitions.find((option) => option.to === "booked");
    check("B is offered Book", Boolean(booking), bOwn.permissions.transitions.map((option) => option.to));
    check("…with nothing standing in the way of it", booking?.blocker === null && !booking.needsNote, booking);
    check("…but flagged for the driver and the truck it has not named", booking?.flags.join(",") === "NO_DRIVER,NO_TRUCK", booking?.flags);
    check("…while the load, only confirmed so far, is missing nothing yet", bOwn.flags.length === 0, bOwn.flags);

    const booked = await b.transition({ id: accepted.id, to: "booked", expectedVersion: bOwn.version });
    check("the move goes through anyway", booked.status === "booked", booked);
    check("…and the trail records what it went through without", await flagsOn(accepted.id, "booked") === "NO_DRIVER,NO_TRUCK", await flagsOn(accepted.id, "booked"));

    bOwn = await b.get({ id: accepted.id });
    check("…which is what the load now shows as open", bOwn.flags.join(",") === "NO_DRIVER,NO_TRUCK", bOwn.flags);

    aDetail = await a.get({ id: filed.id });
    check("A's order followed it into Booked", aDetail.status === "booked", aDetail.status);
    const carriedUp = aDetail.events.filter((event) => event.kind === "system" && event.toStatus === "booked");
    check("…carried up once, with nobody named as having done it", carriedUp.length === 1 && carriedUp[0]?.actorName === null, carriedUp);
    check("…and B's gaps stay B's: A's order shows none", aDetail.flags.length === 0, aDetail.flags);
    check("…nor does its trail leak them", aDetail.events.every((event) => event.flags.length === 0), aDetail.events);
    check("…and A, whose truck this is not, may only call it off", aDetail.permissions.transitions.map((option) => option.to).join(",") === "cancelled", aDetail.permissions.transitions);

    const aBooked = await a.list({ scope: "orders", section: "booked" });
    const aStillConfirmed = await a.list({ scope: "orders", section: "procurement", status: "scheduled" });
    check("…and it moved from Confirmed to Booked", aBooked.items.some((row) => row.id === filed.id)
        && !aStillConfirmed.items.some((row) => row.id === filed.id), { booked: aBooked.items.map((row) => row.ref), confirmed: aStillConfirmed.items.map((row) => row.ref) });

    console.log("\n— B names its driver and the truck reaches the loading site");
    const phone = "+258840000999";
    const named = await b.update({ id: accepted.id, expectedVersion: bOwn.version, driverName: "HARNESS Driver", driverPhone: phone, truckPlate: "HAR-001-MP" });
    await b.transition({ id: accepted.id, to: "at-loading", expectedVersion: named.version });

    aDetail = await a.get({ id: filed.id });
    check("A's order followed B's truck to the loading site", aDetail.status === "at-loading", aDetail.status);
    check("…with a trail line that says it was carried up", aDetail.events.some((event) => event.kind === "system" && event.toStatus === "at-loading"), aDetail.events);
    check("…and still no phone of B's driver", aDetail.driverPhone === null);
    check("…but it knows which truck is coming", aDetail.driverName === "HARNESS Driver" && aDetail.truckPlate === "HAR-001-MP", { driver: aDetail.driverName, plate: aDetail.truckPlate });

    const aOrderRows = await a.list({ scope: "orders", section: "in-progress" });
    const aOrderRow = aOrderRows.items.find((row) => row.id === filed.id);
    check("…in its list too", aOrderRow?.truckPlate === "HAR-001-MP", aOrderRow);

    const usage = await db
        .select({ org: subscriptionUsage.organizationId, entity: subscriptionUsage.entityId })
        .from(subscriptionUsage)
        .where(and(eq(subscriptionUsage.entityType, "movement"), inArray(subscriptionUsage.entityId, created)));
    check("each company is billed once, for its own row", usage.length === 2
        && usage.some((row) => row.org === A.org && row.entity === filed.id)
        && usage.some((row) => row.org === B.org && row.entity === accepted.id), usage);

    console.log("\n— the warehouse photographs the load, and somebody answers for it");
    const bm = as(BM.user);
    await bm.documents.add({
        movementId: accepted.id,
        type: "loading-photo",
        url: "https://files.edgestore.dev/harness/loading-1.jpg",
        title: "HARNESS loading 1",
        mimeType: "image/jpeg",
    });

    bOwn = await b.get({ id: accepted.id });
    let photo = bOwn.documents.find((document) => document.type === "loading-photo");
    check("B's member may file a loading photo", Boolean(photo), bOwn.documents.map((document) => document.type));
    check("…which starts out waiting for somebody", photo?.approvedAt === null && photo.approvedByName === null, photo);
    let loading = bOwn.permissions.transitions.find((option) => option.to === "loading");
    check("…and loading would start with it unapproved", loading?.flags.includes("PHOTOS_UNAPPROVED") ?? false, loading?.flags);

    await expectError("the member who took it cannot also approve it", () =>
        bm.documents.approve({ id: photo!.id }), "NOT_ALLOWED");

    await b.documents.approve({ id: photo!.id });
    bOwn = await b.get({ id: accepted.id });
    photo = bOwn.documents.find((document) => document.type === "loading-photo");
    check("B's owner approves it, and the photo says who did", photo?.approvedAt !== null && Boolean(photo?.approvedByName), photo);
    loading = bOwn.permissions.transitions.find((option) => option.to === "loading");
    check("…so loading is no longer a gap", !(loading?.flags.includes("PHOTOS_UNAPPROVED") ?? true), loading?.flags);
    check("…and the trail has the approval on it", bOwn.events.some((event) => event.kind === "document" && event.action === "approved"), bOwn.events.filter((event) => event.kind === "document"));

    await expectError("approving it twice finds nothing left to approve", () =>
        b.documents.approve({ id: photo!.id }), "NOT_APPROVABLE");

    console.log("\n— the silent failure: both rows carry the driver's phone");
    // The case the fix exists for: A typed this phone while the partner was
    // off the platform, then the partner joined and took the load
    await db.update(movement).set({ driverPhone: phone }).where(eq(movement.id, filed.id));
    const pinOwner = await resolveMovementForConversation(db, { conversationId: "harness-no-thread", driverPhone: normalizePhone(phone) });
    check("a pin on that phone lands on B's row, not nowhere", pinOwner?.id === accepted.id, pinOwner);

    console.log("\n— the driver's thread, read on the row that holds the truck");
    // What requestLocation writes, without spending a WhatsApp send: the
    // conversation keyed by the driver's number, stamped on B's row, and
    // the question on it
    const asked = await simulateRequest(phone, "HARNESS Driver", accepted.id);

    const aThread = await a.thread({ id: filed.id });
    check("A's order reads no thread: the driver is B's to talk to", aThread.length === 0, aThread);
    await expectError("…and B's own row is not A's to open at all", () => a.thread({ id: accepted.id }), "NOT_FOUND");

    const bThread = await b.thread({ id: accepted.id });
    const lastSaid = bThread.at(-1);
    check("B reads what was asked of its driver, through the conversation its own asking stamped",
        lastSaid?.id === asked && lastSaid.direction === "outbound" && lastSaid.status === "sent", bThread);

    await db.update(movement).set({ driverPhone: null }).where(eq(movement.id, filed.id));

    console.log("\n— the proof of delivery travels up");
    const proof = await b.documents.add({ movementId: accepted.id, type: "pod", url: "https://files.edgestore.dev/harness/pod.pdf", title: "HARNESS POD" });
    await expectError("a paper that is not a photo is not approvable at all", () =>
        b.documents.approve({ id: proof.id }), "NOT_APPROVABLE");
    await b.documents.add({ movementId: accepted.id, type: "invoice", leg: "sell", url: "https://files.edgestore.dev/harness/invoice.pdf", title: "HARNESS B invoice" });
    aDetail = await a.get({ id: filed.id });
    const pod = aDetail.documents.find((document) => document.title === "HARNESS POD");
    check("B's POD shows on A's order", Boolean(pod), aDetail.documents.map((document) => document.title));
    check("…without naming who at B uploaded it", pod?.uploadedByName === null, pod);
    check("…and B's own invoice to A does not ride up with it", !aDetail.documents.some((document) => document.title === "HARNESS B invoice"), aDetail.documents.map((document) => document.title));

    console.log("\n— delivery, money, and the books closing");
    const bReportBefore = await loadsLine(B.user, "MZN");
    const aReportBefore = await loadsLine(A.user, "MZN");
    await walk(b, accepted.id, ["loading", "on-route", "at-offloading", "offloading", "delivered"]);
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

    console.log("\n— and a truck that loads on a photo nobody looked at loads anyway, on the record");
    const unseen = await b.create({
        execution: "own-fleet", origin, destination, cargoDescription: "HARNESS unapproved photo",
        driverName: "HARNESS Four", driverPhone: "+258840000996", truckPlate: "HAR-004-MP", status: "scheduled",
    });
    created.push(unseen.id);
    await b.documents.add({ movementId: unseen.id, type: "loading-photo", url: "https://files.edgestore.dev/harness/loading-2.jpg", title: "HARNESS loading 2", mimeType: "image/jpeg" });

    await walk(b, unseen.id, ["at-loading"]);
    let unseenDetail = await b.get({ id: unseen.id });
    check("a load waiting on a photo is not stopped from loading", unseenDetail.permissions.transitions.some((option) => option.to === "loading" && option.blocker === null), unseenDetail.permissions.transitions);
    await b.transition({ id: unseen.id, to: "loading", expectedVersion: unseenDetail.version });
    check("…and the trail records that it loaded with the photo unapproved", await flagsOn(unseen.id, "loading") === "PHOTOS_UNAPPROVED", await flagsOn(unseen.id, "loading"));

    unseenDetail = await b.get({ id: unseen.id });
    check("…which is what the load shows as open while it runs", unseenDetail.flags.join(",") === "PHOTOS_UNAPPROVED", unseenDetail.flags);
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
    check("B's rail counts the offer as received", railB.received >= 1, railB);

    const probe = await b.list({ scope: "trips", section: "planning", search: "ACME-PO" });
    check("searching Trips ▸ Planning by A's client reference finds nothing", !probe.items.some((row) => row.id === filed.id), probe.items.map((row) => row.ref));

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
    check("…and never what B's own paperwork was missing", aAsClient.flags.length === 0 && aAsClient.events.every((event) => event.flags.length === 0), { flags: aAsClient.flags, events: aAsClient.events });
    await expectError("…and cannot move it", () => a.transition({ id: accepted.id, to: "at-loading", expectedVersion: named.version }), "NOT_FOUND");

    console.log("\n— one notification per milestone, not one per role");
    const before = await startedFor(A.org);
    await b.transition({ id: accepted.id, to: "at-loading", expectedVersion: named.version });
    const after = await startedFor(A.org);
    const members = await membersOf(A.org);
    check("A hears once that B's truck reached the load", after - before === members, { before, after, members });

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
    await db.update(movement).set({ status: "on-route" }).where(eq(movement.id, secondAccept.id));
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

    console.log("\n— and once it is booked, from either end");
    const fourth = await a.create({
        execution: "partner", carrierOrgId: B.org, origin, destination, cargoDescription: "HARNESS booked cancel",
        buy: { total: 1200, currency: "MZN" },
    });
    created.push(fourth.id);
    aDetail = await a.get({ id: fourth.id });
    const fourthOffer = await a.offer({ id: fourth.id, expectedVersion: aDetail.version });
    const fourthAccept = await b.respond({ id: fourth.id, expectedVersion: fourthOffer.version, decision: "accept" });
    created.push(fourthAccept.id);
    const fourthOwn = await b.get({ id: fourthAccept.id });
    const fourthBooked = await b.transition({ id: fourthAccept.id, to: "booked", expectedVersion: fourthOwn.version });
    await b.transition({ id: fourthAccept.id, to: "cancelled", expectedVersion: fourthBooked.version, note: "HARNESS truck broke down" });
    aDetail = await a.get({ id: fourth.id });
    check("B dropping its booked row hands the load back to A", aDetail.status === "declined", aDetail.status);
    check("…unlinked, for A to place with somebody else", !aDetail.isLinked, aDetail.isLinked);

    const fifth = await a.create({
        execution: "partner", carrierOrgId: B.org, origin, destination, cargoDescription: "HARNESS booked cancel from above",
        buy: { total: 1300, currency: "MZN" },
    });
    created.push(fifth.id);
    aDetail = await a.get({ id: fifth.id });
    const fifthOffer = await a.offer({ id: fifth.id, expectedVersion: aDetail.version });
    const fifthAccept = await b.respond({ id: fifth.id, expectedVersion: fifthOffer.version, decision: "accept" });
    created.push(fifthAccept.id);
    const fifthOwn = await b.get({ id: fifthAccept.id });
    await b.transition({ id: fifthAccept.id, to: "booked", expectedVersion: fifthOwn.version });
    aDetail = await a.get({ id: fifth.id });
    await a.transition({ id: fifth.id, to: "cancelled", expectedVersion: aDetail.version, note: "HARNESS client changed plans" });
    const [topA] = await db.select({ status: movement.status }).from(movement).where(eq(movement.id, fifth.id));
    const [topB] = await db.select({ status: movement.status }).from(movement).where(eq(movement.id, fifthAccept.id));
    check("A calling off a booked order takes B's booked row with it", topA?.status === "cancelled" && topB?.status === "cancelled", { topA, topB });

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

    console.log("\n— a load may be filed with nothing on it, and says so");
    const bare = await a.create({
        execution: "partner", origin, destination, cargoDescription: "HARNESS flagged", status: "scheduled",
    });
    created.push(bare.id);
    const bareDetail = await a.get({ id: bare.id });
    check("an order placed with nobody, for no price, is filed all the same", bareDetail.status === "scheduled", bareDetail.status);
    check("…and its first trail line says what it was filed without", await flagsOn(bare.id, "scheduled") === "NO_CARRIER,NO_PRICE", await flagsOn(bare.id, "scheduled"));
    check("…as does the load", bareDetail.flags.join(",") === "NO_CARRIER,NO_PRICE", bareDetail.flags);

    console.log("\n— the two moves that still cannot be taken");
    const rigless = await b.create({ execution: "own-fleet", origin, destination, cargoDescription: "HARNESS booked", status: "scheduled" });
    created.push(rigless.id);
    let riglessDetail = await b.get({ id: rigless.id });
    check("a trip is scheduled with no driver at all", riglessDetail.status === "scheduled", riglessDetail.status);
    const riglessBooked = await b.transition({ id: rigless.id, to: "booked", expectedVersion: riglessDetail.version });
    check("…and booked without one", riglessBooked.status === "booked", riglessBooked);
    check("…with both gaps on the trail", await flagsOn(rigless.id, "booked") === "NO_DRIVER,NO_TRUCK", await flagsOn(rigless.id, "booked"));
    await expectError("calling a booked load off still needs a reason", () =>
        b.transition({ id: rigless.id, to: "cancelled", expectedVersion: riglessBooked.version }), "NOTE_REQUIRED");
    await b.transition({ id: rigless.id, to: "cancelled", expectedVersion: riglessBooked.version, note: "HARNESS no truck free" });
    riglessDetail = await b.get({ id: rigless.id });
    check("…and goes through with one", riglessDetail.status === "cancelled", riglessDetail.status);

    console.log("\n— closed books stay closed");
    const own = await b.create({ execution: "own-fleet", origin, destination, cargoDescription: "HARNESS closed", driverName: "HARNESS Three", driverPhone: "+258840000997", status: "scheduled" });
    created.push(own.id);
    const cost = await b.costs.add({ movementId: own.id, kind: "fuel", amount: 100, currency: "MZN" });
    let o = await b.get({ id: own.id });
    const cancelled = await b.transition({ id: own.id, to: "cancelled", expectedVersion: o.version, note: "HARNESS" });
    void cancelled;
    await expectError("a cost line cannot be taken off a cancelled load", () => b.costs.remove({ id: cost.id }), "MOVEMENT_CLOSED");

    console.log("\n— a partner that joined after its load left keeps the load's lifecycle");
    const late = ownerTargets({ execution: "partner", status: "on-route", route: "national", resumeStatus: null, linked: false, executorOnPortal: true });
    check("the owner can still take it on to offloading or call it off", late.includes("at-offloading") && late.includes("cancelled"), late);
    o = await b.get({ id: own.id });
    void o;
}

/** One notification row goes to each member of a company. */
async function membersOf(organizationId: string): Promise<number> {
    const [row] = await db.select({ value: count() }).from(member).where(eq(member.organizationId, organizationId));
    return row?.value ?? 0;
}

/** How many "your load is in progress" notifications a company has had. */
async function startedFor(organizationId: string): Promise<number> {
    const [row] = await db
        .select({ value: count() })
        .from(notification)
        .where(and(eq(notification.organizationId, organizationId), eq(notification.kind, "movement.started")));
    return row?.value ?? 0;
}

/**
 * The palette reaches across the portal and never across tenants: it answers
 * the loads a company's own lists hold — once each, so a load a partner
 * accepted is not both its own order and the partner's row — and answers a
 * company with no part in any of them nothing at all.
 */
async function palette() {
    const a = as(A.user);
    const b = as(B.user);

    console.log("\n— the ⌘K palette");
    const order = await a.create({
        execution: "partner", carrierOrgId: B.org, origin, destination,
        cargoDescription: "HARNESS palette", buy: { total: 41000, currency: "MZN" },
    });
    created.push(order.id);

    const aDetail = await a.get({ id: order.id });
    const offered = await a.offer({ id: order.id, expectedVersion: aDetail.version });
    const executorRow = await b.respond({ id: order.id, expectedVersion: offered.version, decision: "accept" });
    created.push(executorRow.id);

    const mine = await searchFor(A.user).global({ query: "HARNESS" });
    const ids = mine.loads.map((load) => load.id);
    check("A's palette finds its own order and never B's row for it",
        ids.includes(order.id) && !ids.includes(executorRow.id), mine.loads.map((load) => load.ref));

    const stranger = await searchFor(C.user).global({ query: "HARNESS" });
    check("a stranger's palette finds nothing at all",
        stranger.loads.length === 0 && stranger.partners.length === 0
        && stranger.drivers.length === 0 && stranger.vehicles.length === 0, stranger);
}

/**
 * Claire's rule, once a slot's window has closed: the driver who sent nothing,
 * the one who barely moved and the one who picked a place off his phone all
 * get their own company's owners told — and the client too, the second round
 * running. Driven on invented slot dates so it never collides with a real
 * window, and on B's own truck, for A as its client.
 */
async function reviewedSlots() {
    const b = as(B.user);

    console.log("\n— the end-of-slot review");
    const load = await b.create({
        execution: "own-fleet", origin, destination, cargoDescription: "HARNESS review",
        driverName: "HARNESS Quiet", driverPhone: "+258840000996", status: "scheduled",
    });
    created.push(load.id);

    // On route, for a client that is on the portal — which is what lets the
    // second bad round in a row reach A as well
    await db.update(movement).set({ status: "on-route", clientOrgId: A.org }).where(eq(movement.id, load.id));

    const quiet: SlotInfo = { slotDate: "2099-03-01", slot: "morning", minutesIntoSlot: 95 };
    const picked: SlotInfo = { slotDate: "2099-03-02", slot: "morning", minutesIntoSlot: 95 };
    const parked: SlotInfo = { slotDate: "2099-03-02", slot: "afternoon", minutesIntoSlot: 95 };

    /**
     * The driver was reached in this slot and his chain is spent: what makes
     * the slot reviewable at all. The status is the shape the webhook would
     * have left behind — a driver who replied at all closes every open request
     * on the thread, so only the one who stayed silent still reads "sent".
     *
     * Written as the last attempt, and dated an hour ago rather than at the
     * invented slot's own instant: the review refuses to judge a chain that
     * still owes the driver an attempt or whose last one went out minutes ago,
     * and 2099 is in the future.
     */
    const asked = (info: SlotInfo, status: TrackingStatus, movementId = load.id) =>
        db.insert(movementTrackingRequest).values({
            movementId, slotDate: info.slotDate, slot: info.slot,
            attempt: MAX_ATTEMPTS, channel: channelFor(MAX_ATTEMPTS), status,
            scheduledFor: slotStart(info), createdAt: new Date(Date.now() - 60 * 60_000),
        });

    /** A position half an hour into the slot; `placeName` set is a chosen address. */
    const pinged = (info: SlotInfo, lat: number, lng: number, placeName: string | null) =>
        db.insert(movementLocation).values({
            movementId: load.id, latitude: lat, longitude: lng, placeName,
            recordedAt: new Date(slotStart(info).getTime() + 30 * 60_000),
        });

    const alertOn = async (info: SlotInfo, movementId = load.id) => {
        const [row] = await db
            .select({ issue: movementTrackingAlert.issue, streak: movementTrackingAlert.streak })
            .from(movementTrackingAlert)
            .where(and(
                eq(movementTrackingAlert.movementId, movementId),
                eq(movementTrackingAlert.slotDate, info.slotDate),
                eq(movementTrackingAlert.slot, info.slot),
            ));
        return row;
    };

    /** Alert rows in one person's inbox for this load. */
    const inboxOf = async (userId: string) => {
        const [row] = await db
            .select({ value: count() })
            .from(notification)
            .where(and(
                eq(notification.userId, userId),
                eq(notification.entityId, load.id),
                eq(notification.kind, "movement.location-alert"),
            ));
        return row?.value ?? 0;
    };

    /** Alert rows across a whole company. */
    const heardAt = async (organizationId: string) => {
        const [row] = await db
            .select({ value: count() })
            .from(notification)
            .where(and(
                eq(notification.organizationId, organizationId),
                eq(notification.entityId, load.id),
                eq(notification.kind, "movement.location-alert"),
            ));
        return row?.value ?? 0;
    };

    console.log(`  before: B owner ${await inboxOf(B.user)}, B member ${await inboxOf(BM.user)}, A ${await heardAt(A.org)}`);

    await asked(quiet, "sent");
    let run = await reviewMovementSlot(db, quiet);
    check("a slot the driver never answered raises one alert", run.reviewed === 1 && run.alerts === 1, run);
    check("…filed as no-location, first round", (await alertOn(quiet))?.issue === "no-location" && (await alertOn(quiet))?.streak === 1, await alertOn(quiet));
    check("…in B's owner's inbox", await inboxOf(B.user) === 1);
    check("…and nowhere else: not B's member, not the client", await inboxOf(BM.user) === 0 && await heardAt(A.org) === 0,
        { member: await inboxOf(BM.user), client: await heardAt(A.org) });

    await asked(picked, "responded");
    await pinged(picked, -15.1165, 39.2666, "Nampula, Mozambique");
    run = await reviewMovementSlot(db, picked);
    check("a chosen address is not a position", (await alertOn(picked))?.issue === "picked-address" && run.alerts === 1, await alertOn(picked));
    check("…and starts its own round, the slot before it having been answered", (await alertOn(picked))?.streak === 1, await alertOn(picked));
    check("…still the owner's business alone", await inboxOf(B.user) === 2 && await heardAt(A.org) === 0,
        { owner: await inboxOf(B.user), client: await heardAt(A.org) });

    await asked(parked, "responded");
    await pinged(parked, -15.1650, 39.2840, null);
    run = await reviewMovementSlot(db, parked);
    check("six kilometres in half a day is standing still", (await alertOn(parked))?.issue === "short-distance" && run.alerts === 1, await alertOn(parked));
    check("…the second round running", (await alertOn(parked))?.streak === 2, await alertOn(parked));
    check("…so the client is told too, every member of it", await heardAt(A.org) === await membersOf(A.org),
        { client: await heardAt(A.org), members: await membersOf(A.org) });
    check("…and B's member still hears nothing", await inboxOf(BM.user) === 0);

    const ownerBefore = await inboxOf(B.user);
    const clientBefore = await heardAt(A.org);
    run = await reviewMovementSlot(db, parked);
    check("a later tick of the same window judges it again and writes nothing", run.reviewed === 1 && run.alerts === 0, run);
    check("…so nobody is told twice", await inboxOf(B.user) === ownerBefore && await heardAt(A.org) === clientBefore,
        { owner: await inboxOf(B.user), client: await heardAt(A.org) });

    // A round that follows the *previous day's* afternoon: the half of the
    // streak the same-day pair above never exercises, and the one a wrong day
    // offset would silently get away with
    const silent: SlotInfo = { slotDate: "2099-03-03", slot: "afternoon", minutesIntoSlot: 95 };
    const morningAfter: SlotInfo = { slotDate: "2099-03-04", slot: "morning", minutesIntoSlot: 95 };

    await asked(silent, "sent");
    await reviewMovementSlot(db, silent);
    check("an afternoon of its own opens a fresh round", (await alertOn(silent))?.streak === 1, await alertOn(silent));

    // A second load of B's on route that nobody asked anything this slot:
    // silence nobody asked for is not the driver's, so it must be left out of
    // the review altogether
    const unasked = await b.create({
        execution: "own-fleet", origin, destination, cargoDescription: "HARNESS review unasked",
        driverName: "HARNESS Unasked", driverPhone: "+258840000995", status: "scheduled",
    });
    created.push(unasked.id);
    await db.update(movement).set({ status: "on-route", clientOrgId: A.org }).where(eq(movement.id, unasked.id));

    await asked(morningAfter, "sent");
    run = await reviewMovementSlot(db, morningAfter);
    check("the morning after carries the afternoon's round across midnight",
        (await alertOn(morningAfter))?.streak === 2, await alertOn(morningAfter));
    check("…and the load nobody asked is neither judged nor alerted",
        run.reviewed === 1 && await alertOn(morningAfter, unasked.id) === undefined,
        { run, unasked: await alertOn(morningAfter, unasked.id) });

    console.log(`  after: B owner ${await inboxOf(B.user)}, B member ${await inboxOf(BM.user)}, A ${await heardAt(A.org)}`);

    console.log("\n— §11.6 the same two pings, judged on route and at the border");
    // Two of B's loads, one on route and one at the border, each answering the
    // slot with the same position six kilometres from the one before it
    const road: SlotInfo = { slotDate: "2099-03-05", slot: "morning", minutesIntoSlot: 95 };
    const judged: Record<"on-route" | "at-border", string> = { "on-route": "", "at-border": "" };

    for (const [status, driverPhone] of [["on-route", "+258840000996"], ["at-border", "+258840000995"]] as const) {
        const twin = await b.create({
            execution: "own-fleet", origin, destination, cargoDescription: `HARNESS review ${status}`,
            driverName: "HARNESS Twin", driverPhone, status: "scheduled",
        });
        created.push(twin.id);
        judged[status] = twin.id;

        await db.update(movement).set({ status }).where(eq(movement.id, twin.id));
        await asked(road, "responded", twin.id);
        await db.insert(movementLocation).values([
            { movementId: twin.id, latitude: -15.1165, longitude: 39.2666, placeName: null, recordedAt: new Date(slotStart(road).getTime() - 3 * 60 * 60_000) },
            { movementId: twin.id, latitude: -15.1650, longitude: 39.2840, placeName: null, recordedAt: new Date(slotStart(road).getTime() + 30 * 60_000) },
        ]);
    }

    run = await reviewMovementSlot(db, road);
    check("on route, six kilometres is standing still", (await alertOn(road, judged["on-route"]))?.issue === "short-distance", await alertOn(road, judged["on-route"]));
    check("…at the border the same two pings raise nothing", run.reviewed === 2 && run.alerts === 1 && await alertOn(road, judged["at-border"]) === undefined,
        { run, border: await alertOn(road, judged["at-border"]) });
}

/** §11.13 — what the dev script had to leave behind: not one row of the removed status. */
async function migratedData() {
    console.log("\n— §11.13 nothing is left in-transit once the dev script ran");
    const { rows: [left] } = await db.execute<{ status: number; from_status: number; to_status: number }>(sql`
        select
            (select count(*)::int from ${movement} where status = 'in-transit') as status,
            (select count(*)::int from ${movementEvent} where from_status = 'in-transit') as from_status,
            (select count(*)::int from ${movementEvent} where to_status = 'in-transit') as to_status
    `);

    check("no movement is left in-transit", left?.status === 0, left);
    check("no trail line leaves in-transit", left?.from_status === 0, left);
    check("no trail line enters in-transit", left?.to_status === 0, left);
}

/**
 * §11.1 — B's own truck along the whole chain, read off the row after each
 * move: the start is stamped once, an interruption remembers where it
 * resumes, and a national load never stops at a border.
 */
async function manualChain() {
    const b = as(B.user);

    console.log("\n— §11.1 the manual chain end to end, with its stamps");
    const trip = await b.create({
        execution: "own-fleet", origin, destination, cargoDescription: "HARNESS chain",
        driverName: "HARNESS Chain", truckPlate: "HAR-011-MP", status: "booked",
    });
    created.push(trip.id);

    let detail = await b.get({ id: trip.id });
    const start = detail.permissions.transitions.find((option) => option.to === "at-loading");
    check("a booked trip's way on is the loading site, which starts tracking", detail.permissions.transitions.map((option) => option.to).join(",") === "at-loading,cancelled"
        && start?.startsTracking === true, detail.permissions.transitions);

    let { version } = await b.transition({ id: trip.id, to: "at-loading", expectedVersion: detail.version });
    const arrived = await stampsOf(trip.id);
    check("reaching the loading site stamps the start", arrived.startedAt !== null && arrived.resumeStatus === null, arrived);

    await expectError("stopping without saying why is refused", () =>
        b.transition({ id: trip.id, to: "stopped", expectedVersion: version }), "NOTE_REQUIRED");
    ({ version } = await b.transition({ id: trip.id, to: "stopped", expectedVersion: version, note: "HARNESS gate closed" }));
    check("a stop remembers the stage it interrupted", (await stampsOf(trip.id)).resumeStatus === "at-loading", await stampsOf(trip.id));

    await expectError("…and calling it an issue instead needs a reason too", () =>
        b.transition({ id: trip.id, to: "issue", expectedVersion: version }), "NOTE_REQUIRED");
    ({ version } = await b.transition({ id: trip.id, to: "issue", expectedVersion: version, note: "HARNESS papers missing" }));
    check("stopped → issue keeps where it resumes", (await stampsOf(trip.id)).resumeStatus === "at-loading", await stampsOf(trip.id));
    ({ version } = await b.transition({ id: trip.id, to: "stopped", expectedVersion: version, note: "HARNESS papers found, gate still closed" }));
    check("…and so does issue → stopped", (await stampsOf(trip.id)).resumeStatus === "at-loading", await stampsOf(trip.id));

    detail = await b.get({ id: trip.id });
    const resume = detail.permissions.transitions[0];
    check("the stop's default button is the resume, which starts nothing", resume?.to === "at-loading" && !resume.startsTracking && !resume.needsNote, detail.permissions.transitions);
    ({ version } = await b.transition({ id: trip.id, to: "at-loading", expectedVersion: version }));
    const resumed = await stampsOf(trip.id);
    check("resuming clears it and never restamps the start", resumed.resumeStatus === null && resumed.startedAt?.getTime() === arrived.startedAt?.getTime(), { arrived, resumed });

    version = await walk(b, trip.id, ["loading", "waiting-documents", "on-route"]);
    detail = await b.get({ id: trip.id });
    check("a national load on route is not offered the border", detail.permissions.transitions.map((option) => option.to).join(",") === "at-offloading,stopped,issue,cancelled", detail.permissions.transitions);
    await expectError("…and the door refuses it too", () =>
        b.transition({ id: trip.id, to: "at-border", expectedVersion: version }), "INVALID_STATUS");
    check("…while a regional one is, first", ownerTargets({ execution: "own-fleet", status: "on-route", route: "regional", resumeStatus: null, linked: false, executorOnPortal: false })[0] === "at-border");

    await walk(b, trip.id, ["at-offloading", "offloading", "delivered"]);
    const done = await stampsOf(trip.id);
    check("delivery stamps the day and stops the tracking, the start untouched", done.deliveredAt !== null && !done.trackingEnabled
        && done.startedAt?.getTime() === arrived.startedAt?.getTime(), done);

    const billed = await db.select({ value: count() }).from(subscriptionUsage).where(eq(subscriptionUsage.entityId, trip.id));
    check("…and the plan paid for it once, stops and resumes included", billed[0]?.value === 1, billed);
}

/** §11.2 — placing a partner load is above the plain member, however far along it is. */
async function roleGate() {
    const b = as(B.user);
    const bMember = as(BM.user);

    console.log("\n— §11.2 the role gate on quoting and confirming a partner load");
    const quote = await b.create({
        execution: "partner", carrierName: "HARNESS Quoted Lda", origin, destination, cargoDescription: "HARNESS prospect",
        buy: { total: 2500, currency: "MZN" },
    });
    created.push(quote.id);

    const draft = await b.get({ id: quote.id });
    await expectError("B's member cannot quote it (procurement → prospect)", () =>
        bMember.transition({ id: quote.id, to: "prospect", expectedVersion: draft.version }), "NOT_ALLOWED");
    const memberDraft = await bMember.get({ id: quote.id });
    check("…and is not offered the move", !memberDraft.permissions.transitions.some((option) => option.to === "prospect"), memberDraft.permissions.transitions);

    const quoted = await b.transition({ id: quote.id, to: "prospect", expectedVersion: draft.version });
    await expectError("…nor confirm it once B's owner quoted it (prospect → scheduled)", () =>
        bMember.transition({ id: quote.id, to: "scheduled", expectedVersion: quoted.version }), "NOT_ALLOWED");
    const back = await refusal(() => bMember.transition({ id: quote.id, to: "procurement", expectedVersion: quoted.version }));
    check("…but may take the quote back to the draft, which is only updating it", back === null, back);
}

/**
 * §11.3 — an allowance spent to zero stops a truck from starting, and nothing
 * else: a load already in progress stops, resumes and moves on.
 */
async function quota() {
    const b = as(B.user);

    console.log("\n— §11.3 a spent allowance refuses a start, never a load already in progress");
    const running = await b.create({
        execution: "own-fleet", origin, destination, cargoDescription: "HARNESS quota running",
        driverName: "HARNESS Quota", truckPlate: "HAR-013-MP", status: "booked",
    });
    created.push(running.id);
    await walk(b, running.id, ["at-loading"]);

    const waiting = await b.create({ execution: "own-fleet", origin, destination, cargoDescription: "HARNESS quota waiting", status: "booked" });
    created.push(waiting.id);

    try {
        await spendAllowance(B.org);
        const allowance = await trackingAllowance(db, B.org);
        check("B has nothing left to start this month", allowance.remaining === 0, allowance);

        let refused = await refusal(() => walk(b, running.id, ["stopped", "at-loading"]));
        check("…yet its truck at the loading site stops and resumes", refused === null, refused);
        refused = await refusal(() => walk(b, running.id, ["loading", "on-route", "at-offloading"]));
        check("…and goes on route to offloading", refused === null && (await stampsOf(running.id)).status === "at-offloading", refused);

        const stillBooked = await b.get({ id: waiting.id });
        await expectError("…while a booked load cannot start", () =>
            b.transition({ id: waiting.id, to: "at-loading", expectedVersion: stillBooked.version }), "QUOTA_EXCEEDED");
        await expectError("…nor one filed as already at the loading site", () =>
            b.create({ execution: "own-fleet", origin, destination, cargoDescription: "HARNESS quota filed", status: "at-loading" }), "QUOTA_EXCEEDED");
    } finally {
        await releaseAllowance();
    }
}

/**
 * §11.4 and §11.9 — A's regional order with B, for a client of A's own (C,
 * set straight on the row: the harness needs a client that is not the
 * transporter), walked through every stage of B's truck. Hands the delivered
 * chain on to the disputes.
 */
async function propagation(): Promise<{ order: string; executor: string }> {
    const a = as(A.user);
    const b = as(B.user);

    console.log("\n— §11.9 every stage of the truck's chain travels up the link");
    const order = await a.create({
        execution: "partner", carrierOrgId: B.org, origin, destination, route: "regional",
        cargoDescription: "HARNESS chain up", buy: { total: 4400, currency: "MZN" },
    });
    created.push(order.id);
    await db.update(movement).set({ clientOrgId: C.org }).where(eq(movement.id, order.id));

    const placed = await a.get({ id: order.id });
    const offered = await a.offer({ id: order.id, expectedVersion: placed.version });
    const executor = await b.respond({ id: order.id, expectedVersion: offered.version, decision: "accept" });
    created.push(executor.id);

    const astray: unknown[] = [];

    await walk(
        b,
        executor.id,
        ["booked", "at-loading", "stopped", "at-loading", "loading", "waiting-documents", "on-route", "at-border", "issue", "at-border", "at-offloading", "offloading", "delivered"],
        async (to) => {
            const [orderRow, executorRow] = await Promise.all([stampsOf(order.id), stampsOf(executor.id)]);
            if (orderRow.status !== to || orderRow.resumeStatus !== executorRow.resumeStatus) astray.push({ to, orderRow, executorRow });
        },
    );
    check("A's order took every status B's truck did, and where it resumes", astray.length === 0, astray);

    console.log("\n— §11.4 movement.started once per member, for the client and the owner above");
    const started = await noticesSince("movement.started", [order.id, executor.id], new Set());
    const onceEach = async (organizationId: string) => {
        const mine = started.filter((notice) => notice.organizationId === organizationId);
        return mine.length === await membersOf(organizationId)
            && new Set(mine.map((notice) => notice.userId)).size === mine.length
            && mine.every((notice) => notice.entityId === order.id);
    };
    check("C, the client of A's order, heard it once per member", await onceEach(C.org), started);
    check("A, the owner above, heard it once per member", await onceEach(A.org), started);
    check("B, whose truck it is, heard nothing", !started.some((notice) => notice.organizationId === B.org), started);

    console.log("\n— §11.9 …and a transporter's quote below is called off with the order");
    const second = await a.create({
        execution: "partner", carrierOrgId: B.org, origin, destination,
        cargoDescription: "HARNESS chain converted", buy: { total: 1700, currency: "MZN" },
    });
    created.push(second.id);
    const secondPlaced = await a.get({ id: second.id });
    const secondOffer = await a.offer({ id: second.id, expectedVersion: secondPlaced.version });
    const below = await b.respond({ id: second.id, expectedVersion: secondOffer.version, decision: "accept" });
    created.push(below.id);

    const belowRow = await b.get({ id: below.id });
    const converted = await b.convert({ id: below.id, expectedVersion: belowRow.version, to: "partner", carrierName: "HARNESS Sub Lda" });
    await b.transition({ id: below.id, to: "prospect", expectedVersion: converted.version });

    const secondOrder = await a.get({ id: second.id });
    await a.transition({ id: second.id, to: "cancelled", expectedVersion: secondOrder.version, note: "HARNESS client changed plans" });
    const [orderAfter, belowAfter] = await Promise.all([stampsOf(second.id), stampsOf(below.id)]);
    check("both rows are cancelled", orderAfter.status === "cancelled" && belowAfter.status === "cancelled", { orderAfter, belowAfter });

    return { order: order.id, executor: executor.id };
}

/**
 * §11.11 — disputes on the delivered chain propagation() left: C (client of
 * A's order) opens one, then B (whose truck it was) opens another. Then a
 * load handed back, whose dispute the next executor neither inherits nor is
 * held up by — it disputes its own row, and hears nothing when the first one
 * is settled.
 */
async function disputes({ order, executor }: { order: string; executor: string }) {
    const a = as(A.user);
    const b = as(B.user);
    const c = as(C.user);
    const bMember = as(BM.user);
    const names = new Map((await db
        .select({ id: organization.id, name: organization.name })
        .from(organization)
        .where(inArray(organization.id, [A.org, B.org, C.org]))).map((row) => [row.id, row.name]));
    const seen = new Set<string>();

    console.log("\n— §11.11 a dispute is only for a load somebody committed to");
    const draft = await a.create({
        execution: "partner", carrierName: "HARNESS Draft Lda", origin, destination, cargoDescription: "HARNESS dispute draft",
    });
    created.push(draft.id);
    const draftView = await a.get({ id: draft.id });
    check("a load in procurement offers no dispute", !draftView.permissions.canOpenDispute, draftView.permissions);
    await expectError("…and the door refuses one", () =>
        a.disputes.open({ movementId: draft.id, reason: "other", description: "HARNESS too early" }), "DISPUTE_INVALID_LOAD");

    console.log("\n— §11.11 opened by the client of A's order");
    const [cBefore, bBefore] = await Promise.all([c.get({ id: order }), b.get({ id: order })]);
    check("a delivered load offers the dispute to its client and its executor alike", cBefore.role === "client" && cBefore.permissions.canOpenDispute
        && bBefore.role === "executor" && bBefore.permissions.canOpenDispute, { client: cBefore.permissions.canOpenDispute, executor: bBefore.permissions.canOpenDispute });

    const byClient = await c.disputes.open({ movementId: order, reason: "damage", description: "HARNESS two bags torn" });
    const [aOrder, bRow, bOnOrder, cOrder] = await Promise.all([
        a.get({ id: order }), b.get({ id: executor }), b.get({ id: order }), c.get({ id: order }),
    ]);
    check("the trail of the row it was opened on says so", aOrder.events.some((event) => event.kind === "dispute" && event.action === "opened"), aOrder.events.filter((event) => event.kind === "dispute"));
    check("…and nobody is offered a second one", !aOrder.permissions.canOpenDispute && !cOrder.permissions.canOpenDispute && !bRow.permissions.canOpenDispute);
    check("it shows on the order and on B's row below it", aOrder.dispute?.id === byClient.id && bRow.dispute?.id === byClient.id, { order: aOrder.dispute, row: bRow.dispute });
    check("…where A reads its own client by name", aOrder.dispute?.openedBy.side === "client" && aOrder.dispute.openedBy.name === names.get(C.org), aOrder.dispute);
    check("…B, on its own row, only that a company on the load did", bRow.dispute?.openedBy.side === "client" && bRow.dispute.openedBy.name === null, bRow.dispute);
    check("…and B, executing the order, never who the load is for", bOnOrder.dispute?.openedBy.side === "client" && bOnOrder.dispute.openedBy.name === null, bOnOrder.dispute);
    check("…the verbatim description reaches every covered party", [aOrder, bRow, bOnOrder, cOrder].every((view) => view.dispute?.description === "HARNESS two bags torn"));
    check("only the client may resolve it", cOrder.dispute?.openedBy.side === "you" && cOrder.dispute.canResolve && !aOrder.dispute?.canResolve && !bRow.dispute?.canResolve,
        { client: cOrder.dispute, owner: aOrder.dispute?.canResolve, executor: bRow.dispute?.canResolve });

    // §12.3 — the company that raised it must still be on the load to settle it
    check("…and A cannot swap the client off the load while it is open", !aOrder.permissions.editable.includes("client"), aOrder.permissions.editable);
    await expectError("…the door refuses the change too", () =>
        a.update({ id: order, expectedVersion: aOrder.version, clientName: "HARNESS somebody else" }), "FIELD_LOCKED");

    const [aDisputes, bDisputes, aRail, bRail, aStats, bStats] = await Promise.all([
        a.list({ scope: "orders", section: "disputes" }), b.list({ scope: "trips", section: "disputes" }),
        meFor(A.user).railCounts(), meFor(B.user).railCounts(),
        a.stats({ scope: "orders" }), b.stats({ scope: "trips" }),
    ]);
    check("both rows sit in their company's Disputes section, chipped", Boolean(aDisputes.items.find((row) => row.id === order)?.inDispute)
        && Boolean(bDisputes.items.find((row) => row.id === executor)?.inDispute), { orders: aDisputes.items.map((row) => row.ref), trips: bDisputes.items.map((row) => row.ref) });
    check("…counted alike by the rail and the section", aRail.disputes.orders === aStats.bySection.disputes && bRail.disputes.trips === bStats.bySection.disputes,
        { aRail: aRail.disputes, aStats: aStats.bySection.disputes, bRail: bRail.disputes, bStats: bStats.bySection.disputes });

    let notices = await noticesSince("movement.dispute-opened", [order, executor], seen);
    check("A is told once per member, on its order, naming its client", await toldOnceOn(notices, A.org, order, names.get(C.org)!), notices);
    check("B is told once per member, on its own row, naming nobody", await toldOnceOn(notices, B.org, executor, ""), notices);
    check("…and the client that opened it is not told", !notices.some((notice) => notice.organizationId === C.org), notices);

    await expectError("a second dispute on B's row is refused", () =>
        b.disputes.open({ movementId: executor, reason: "other", description: "HARNESS mine too" }), "DISPUTE_EXISTS");
    await expectError("…and on A's order", () =>
        a.disputes.open({ movementId: order, reason: "other", description: "HARNESS mine too" }), "DISPUTE_EXISTS");

    await expectError("A cannot close its books while it is open", () =>
        a.transition({ id: order, to: "closed", expectedVersion: aOrder.version }), "DISPUTE_OPEN");
    await expectError("…nor can B", () =>
        b.transition({ id: executor, to: "closed", expectedVersion: bRow.version }), "DISPUTE_OPEN");
    await expectError("A cannot resolve a dispute its client opened", () =>
        a.disputes.resolve({ id: byClient.id, resolution: "HARNESS not mine" }), "NOT_FOUND");

    await c.disputes.resolve({ id: byClient.id, resolution: "HARNESS bags replaced" });
    const [aSettled, bSettled] = await Promise.all([a.get({ id: order }), b.get({ id: executor })]);
    check("resolved, it stays on the load as settled", aSettled.dispute?.status === "resolved" && aSettled.dispute.resolution === "HARNESS bags replaced" && !aSettled.inDispute
        && bSettled.dispute?.status === "resolved", { order: aSettled.dispute, row: bSettled.dispute });
    check("…and the client is A's to change again", aSettled.permissions.editable.includes("client"), aSettled.permissions.editable);
    await expectError("…and closing is down to the money again", () =>
        a.transition({ id: order, to: "closed", expectedVersion: aSettled.version }), "UNSETTLED");
    notices = await noticesSince("movement.dispute-resolved", [order, executor], seen);
    check("the resolution reaches A and B once each, on their own rows", await toldOnceOn(notices, A.org, order, names.get(C.org)!)
        && await toldOnceOn(notices, B.org, executor, "") && !notices.some((notice) => notice.organizationId === C.org), notices);

    console.log("\n— §11.11 opened by the executor");
    const byExecutor = await b.disputes.open({ movementId: executor, reason: "loss", description: "HARNESS one pallet short" });
    const [aOnOrder, cOnOrder, aOnRow] = await Promise.all([a.get({ id: order }), c.get({ id: order }), a.get({ id: executor })]);
    check("A reads its transporter by name on its order", aOnOrder.dispute?.id === byExecutor.id && aOnOrder.dispute.openedBy.side === "executor"
        && aOnOrder.dispute.openedBy.name === names.get(B.org), aOnOrder.dispute);
    check("…and on B's row, as its client", aOnRow.dispute?.id === byExecutor.id && aOnRow.dispute.openedBy.side === "owner" && aOnRow.dispute.openedBy.name === names.get(B.org), aOnRow.dispute);
    check("a client of the owner's row never gets the executor's name", cOnOrder.dispute?.id === byExecutor.id && cOnOrder.dispute.openedBy.side === "executor"
        && cOnOrder.dispute.openedBy.name === null && !JSON.stringify(cOnOrder).includes(names.get(B.org)!), cOnOrder.dispute);

    notices = await noticesSince("movement.dispute-opened", [order, executor], seen);
    check("A is told once per member, naming its transporter", await toldOnceOn(notices, A.org, order, names.get(B.org)!), notices);
    check("C is told once per member, on the order, naming nobody", await toldOnceOn(notices, C.org, order, ""), notices);
    check("…and B, which opened it, is not told", !notices.some((notice) => notice.organizationId === B.org), notices);

    await expectError("B's plain member cannot resolve it", () =>
        bMember.disputes.resolve({ id: byExecutor.id, resolution: "HARNESS found it" }), "NOT_ALLOWED");
    await expectError("…nor can another company on the load", () =>
        c.disputes.resolve({ id: byExecutor.id, resolution: "HARNESS found it" }), "NOT_FOUND");
    await b.disputes.resolve({ id: byExecutor.id, resolution: "HARNESS pallet found at the depot" });

    console.log("\n— §11.11 a load handed back keeps its dispute from the next executor");
    const handed = await a.create({
        execution: "partner", carrierOrgId: B.org, origin, destination, cargoDescription: "HARNESS dispute back-out",
        buy: { total: 1600, currency: "MZN" },
    });
    created.push(handed.id);
    let handedView = await a.get({ id: handed.id });
    const firstRound = await a.offer({ id: handed.id, expectedVersion: handedView.version });
    const taken = await b.respond({ id: handed.id, expectedVersion: firstRound.version, decision: "accept" });
    created.push(taken.id);
    const takenBooked = await walk(b, taken.id, ["booked"]);

    const early = await a.disputes.open({ movementId: handed.id, reason: "other", description: "HARNESS papers in question" });
    await b.transition({ id: taken.id, to: "cancelled", expectedVersion: takenBooked, note: "HARNESS truck broke down" });
    handedView = await a.get({ id: handed.id });
    check("the back-out hands A its order, the dispute still pinned to it", handedView.status === "declined" && !handedView.isLinked
        && handedView.dispute?.id === early.id && handedView.inDispute, { status: handedView.status, dispute: handedView.dispute });

    const nextRound = await a.offer({ id: handed.id, expectedVersion: handedView.version });
    const [nextView, nextList] = await Promise.all([b.get({ id: handed.id }), b.list({ scope: "trips", section: "planning", pageSize: 100 })]);
    check("the executor offered it next reads no dispute on it", nextView.role === "executor" && nextView.dispute === null && !nextView.inDispute, nextView.dispute);
    check("…nor a chip in its list", nextList.items.some((row) => row.id === handed.id && !row.inDispute), nextList.items.find((row) => row.id === handed.id));

    console.log("\n— §12.2 the carrier that takes it on next can still dispute the load it is running");
    const retaken = await b.respond({ id: handed.id, expectedVersion: nextRound.version, decision: "accept" });
    created.push(retaken.id);
    const [onOrder, onOwnRow] = await Promise.all([b.get({ id: handed.id }), b.get({ id: retaken.id })]);
    check("the order it now runs is held by a dispute it may not read, and is offered no button that would announce it",
        onOrder.dispute === null && !onOrder.inDispute && !onOrder.permissions.canOpenDispute, { dispute: onOrder.dispute, permissions: onOrder.permissions });
    await expectError("…the door behind that button being the one that would name it", () =>
        b.disputes.open({ movementId: handed.id, reason: "damage", description: "HARNESS on the order above" }), "DISPUTE_EXISTS");
    check("…while its own row, held by nothing, is where it raises one", onOwnRow.permissions.canOpenDispute, onOwnRow.permissions);

    const byNext = await b.disputes.open({ movementId: retaken.id, reason: "damage", description: "HARNESS the second run" });
    const [handedHeld, retakenHeld] = await Promise.all([a.get({ id: handed.id }), b.get({ id: retaken.id })]);
    check("…so its own row takes a dispute of its own", retakenHeld.dispute?.id === byNext.id && retakenHeld.inDispute, retakenHeld.dispute);
    check("…while the order above it keeps the one already on it", handedHeld.dispute?.id === early.id && handedHeld.inDispute, handedHeld.dispute);

    console.log("\n— §12.1 who a dispute is announced to was settled when it was opened");
    await b.transition({ id: retaken.id, to: "cancelled", expectedVersion: retakenHeld.version, note: "HARNESS the truck broke down again" });
    // The harness has three companies, so the carrier of the round after the
    // dispute is written onto the row the way C was made a client above
    await db.update(movement).set({ carrierOrgId: C.org, status: "offered" }).where(eq(movement.id, handed.id));

    await a.disputes.resolve({ id: early.id, resolution: "HARNESS the papers turned up" });
    const settled = await noticesSince("movement.dispute-resolved", [handed.id, taken.id, retaken.id], seen);
    check("the carrier that was on the load when it was opened hears it settled", await toldOnceOn(settled, B.org, taken.id, names.get(A.org)!), settled);
    check("…and the one offered it afterwards is never told", !settled.some((notice) => notice.organizationId === C.org), settled);
}

/**
 * §11.5 — a truck is tracked from the loading site to offloading, stops
 * included, and not a moment either side of that. B's own trip on one of the
 * harness's fake numbers; the WhatsApp request is written straight to the
 * table, so nothing is sent.
 */
async function tracking() {
    const b = as(B.user);
    const phone = "+258840000997";

    console.log("\n— §11.5 tracking follows the load in progress, stops included");
    const trip = await b.create({
        execution: "own-fleet", origin, destination, cargoDescription: "HARNESS tracking",
        driverName: "HARNESS Three", driverPhone: phone, truckPlate: "HAR-015-MP", status: "booked",
    });
    created.push(trip.id);

    const pinFor = () => resolveMovementForConversation(db, { conversationId: "harness-no-thread", driverPhone: normalizePhone(phone) });

    check("a booked load takes no pin", await pinFor() === null, await pinFor());
    await expectError("…and its driver cannot be asked where he is", () => b.requestLocation({ id: trip.id }), "NOT_TRACKABLE");

    await walk(b, trip.id, ["at-loading"]);
    check("at the loading site the pin is the load's", (await pinFor())?.id === trip.id, await pinFor());

    await walk(b, trip.id, ["stopped"]);
    check("…and still while it is stopped", (await pinFor())?.id === trip.id, await pinFor());

    const pin = (await mapFor(B.user).overview()).find((entity) => entity.kind === "load" && entity.id === trip.id);
    check("the map draws the stopped load in its chip's tone", pin?.status === movementTone("stopped"), pin?.status);

    // Asked this morning, and silent since
    await db.insert(movementTrackingRequest).values({
        movementId: trip.id, slotDate: new Date(Date.now() + MAPUTO_OFFSET_MS).toISOString().slice(0, 10), slot: "morning",
        attempt: 1, channel: channelFor(1), status: "sent", scheduledFor: new Date(),
    });
    const [silent, stats] = await Promise.all([
        b.list({ scope: "trips", section: "in-progress", silent: true, pageSize: 100 }),
        b.stats({ scope: "trips" }),
    ]);
    check("a stopped load whose driver went quiet counts as silent", silent.items.some((row) => row.id === trip.id) && stats.silent === silent.total,
        { listed: silent.items.map((row) => row.ref), total: silent.total, silent: stats.silent });

    await walk(b, trip.id, ["at-loading", "loading", "on-route", "at-offloading", "offloading", "delivered"]);
    check("a delivered load takes no pin", await pinFor() === null, await pinFor());
}

/** §11.7 — an offer in front of a carrier is planning work on Trips, and nothing on Orders. */
async function receivedOffer() {
    const a = as(A.user);
    const b = as(B.user);

    console.log("\n— §11.7 an offer received is Trips planning work");
    const order = await a.create({
        execution: "partner", carrierOrgId: B.org, origin, destination, cargoDescription: "HARNESS received",
        buy: { total: 1800, currency: "MZN" },
    });
    created.push(order.id);
    const placed = await a.get({ id: order.id });
    const offered = await a.offer({ id: order.id, expectedVersion: placed.version });

    const [planning, prospect, all, orders, rail, stats] = await Promise.all([
        b.list({ scope: "trips", section: "planning", pageSize: 100 }),
        b.list({ scope: "trips", section: "planning", status: "prospect", pageSize: 100 }),
        b.list({ scope: "trips", section: "all", pageSize: 100 }),
        b.list({ scope: "orders", section: "all", pageSize: 100 }),
        meFor(B.user).railCounts(),
        b.stats({ scope: "trips" }),
    ]);
    const has = (list: { items: { id: string }[] }) => list.items.some((row) => row.id === order.id);
    check("B's Trips ▸ Planning lists it, under Prospect", has(planning) && has(prospect), { planning: has(planning), prospect: has(prospect) });
    check("…and Trips ▸ All", has(all));
    check("…and Orders does not", !has(orders));
    check("the rail's badge and the tile count the same offers", rail.received === stats.received && stats.received >= 1, { rail: rail.received, stats: stats.received });

    const waiting = await b.get({ id: order.id });
    check("B's way back to it is Trips ▸ Planning", scopeOf(waiting) === "trips" && sectionOf(waiting) === "planning", { scope: scopeOf(waiting), section: sectionOf(waiting) });

    await b.respond({ id: order.id, expectedVersion: offered.version, decision: "decline", note: "HARNESS fully booked" });
    const declined = await b.get({ id: order.id });
    check("…and once declined, Trips ▸ All", scopeOf(declined) === "trips" && sectionOf(declined) === "all", { scope: scopeOf(declined), section: sectionOf(declined) });
}

/**
 * §11.8 — one row in each status each list can hold, written straight to the
 * status column, then every section read once: each row must sit in exactly
 * the section sectionOf names. Then every tab's list against its count.
 */
async function sectionsAndTabs() {
    const a = as(A.user);
    const b = as(B.user);
    const tag = "HARNESS sections";

    console.log("\n— §11.8 every status lands in the section sectionOf names");
    const fixtures = async (caller: ReturnType<typeof as>, execution: "partner" | "own-fleet", statuses: readonly MovementStatus[]) =>
        Promise.all(statuses.map(async (status) => {
            const load = await caller.create({
                execution, origin, destination, cargoDescription: `${tag} ${status}`,
                ...(execution === "partner" && { carrierName: "HARNESS Off-Platform Lda" }),
            });
            created.push(load.id);
            await db.update(movement).set({ status }).where(eq(movement.id, load.id));
            return load.id;
        }));

    const lists = [
        { caller: a, scope: "orders" as const, ids: await fixtures(a, "partner", MOVEMENT_STATUS) },
        // An own-fleet load is never offered or declined: nobody is asked
        { caller: b, scope: "trips" as const, ids: await fixtures(b, "own-fleet", MOVEMENT_STATUS.filter((status) => status !== "offered" && status !== "declined")) },
    ];

    for (const { caller, scope, ids } of lists) {
        const sections = sectionsOf(scope).filter((section) => section !== "all" && section !== "disputes");
        const [rows, ...bySection] = await Promise.all([
            caller.list({ scope, section: "all", search: tag, pageSize: 100 }),
            ...sections.map((section) => caller.list({ scope, section, search: tag, pageSize: 100 })),
        ]);

        const misplaced = rows.items.filter((row) => ids.includes(row.id)).flatMap((row) => {
            const holders = sections.filter((_, index) => bySection[index]!.items.some((item) => item.id === row.id));
            return holders.join() === sectionOf(row) ? [] : [{ status: row.status, sectionOf: sectionOf(row), listedIn: holders }];
        });

        check(`${scope}: each of ${ids.length} statuses sits in exactly the section sectionOf names`, rows.total === ids.length && misplaced.length === 0, { rows: rows.total, misplaced });
    }

    console.log("\n— §11.8 every tab's list holds what its count says");
    for (const { caller, scope } of lists) {
        const stats = await caller.stats({ scope });
        const tabbed = sectionsOf(scope).filter((section) => STATUS_TABS[section]);
        const counted = await Promise.all(tabbed.flatMap((section) => [
            caller.list({ scope, section }).then((list) => ({ section, tab: "all", list: list.total, count: stats.bySection[section] ?? 0 })),
            ...STATUS_TABS[section]!.map((status) => caller.list({ scope, section, status }).then((list) => ({
                section,
                tab: status,
                list: list.total,
                count: status === "prospect" ? (stats.byStatus.prospect ?? 0) + (stats.byStatus.offered ?? 0) : stats.byStatus[status] ?? 0,
            }))),
        ]));
        const wrong = counted.filter((entry) => entry.list !== entry.count);

        check(`${scope}: ${counted.length} tabs, each list's total equal to its count`, wrong.length === 0, wrong);
    }

    const query = (entries: Record<string, string>) => (key: string) => entries[key] ?? null;
    check("the tab param is read only where the section has that tab",
        movementsListInput("orders", "procurement", query({ status: "declined" })).status === "declined"
        && movementsListInput("orders", "procurement", query({ status: "all" })).status === undefined
        && movementsListInput("orders", "procurement", query({ status: "loading" })).status === undefined
        && movementsListInput("trips", "history", query({ status: "closed" })).status === undefined);
}

/**
 * §11.10 — photos are approved before loading starts: an unapproved one is a
 * gap from loading on, never at the loading site, and never on a stop there.
 */
async function photosAtLoading() {
    const b = as(B.user);

    console.log("\n— §11.10 an unapproved photo is a gap from loading on, not before");
    const trip = await b.create({
        execution: "own-fleet", origin, destination, cargoDescription: "HARNESS photo stage",
        driverName: "HARNESS Photo", truckPlate: "HAR-010-MP", status: "booked",
    });
    created.push(trip.id);
    await b.documents.add({ movementId: trip.id, type: "loading-photo", url: "https://files.edgestore.dev/harness/loading-3.jpg", title: "HARNESS loading 3", mimeType: "image/jpeg" });

    const photoFlag = (options: { to: MovementStatus; flags: string[] }[], to: MovementStatus) =>
        options.find((option) => option.to === to)?.flags.includes("PHOTOS_UNAPPROVED");

    let detail = await b.get({ id: trip.id });
    check("reaching the loading site is not flagged for it", photoFlag(detail.permissions.transitions, "at-loading") === false, detail.permissions.transitions);
    await walk(b, trip.id, ["at-loading"]);
    check("…nor is the trail line", !(await flagsOn(trip.id, "at-loading"))?.includes("PHOTOS_UNAPPROVED"), await flagsOn(trip.id, "at-loading"));

    detail = await b.get({ id: trip.id });
    check("a stop at the loading site is not flagged for it", photoFlag(detail.permissions.transitions, "stopped") === false, detail.permissions.transitions);
    await walk(b, trip.id, ["stopped"]);
    detail = await b.get({ id: trip.id });
    check("…nor its trail line, nor the stopped load", !(await flagsOn(trip.id, "stopped"))?.includes("PHOTOS_UNAPPROVED") && !detail.flags.includes("PHOTOS_UNAPPROVED"),
        { trail: await flagsOn(trip.id, "stopped"), load: detail.flags });

    await walk(b, trip.id, ["at-loading"]);
    detail = await b.get({ id: trip.id });
    check("loading is flagged for it", photoFlag(detail.permissions.transitions, "loading") === true, detail.permissions.transitions);
    await walk(b, trip.id, ["loading"]);
    detail = await b.get({ id: trip.id });
    check("…and so are the trail line and the loading load", Boolean((await flagsOn(trip.id, "loading"))?.includes("PHOTOS_UNAPPROVED")) && detail.flags.includes("PHOTOS_UNAPPROVED"),
        { trail: await flagsOn(trip.id, "loading"), load: detail.flags });
}

/**
 * §11.12 — one list per kind, holding what its pill counts; a shipper has no
 * clients. The test tenants' only connection is A and B's, accepted, so C's
 * request to B is staged straight on the table to give Requests a row.
 */
async function partnerLists() {
    console.log("\n— §11.12 the partner lists, one route per kind");

    const [request] = await db
        .insert(partnerConnection)
        .values({ requesterOrgId: C.org, targetOrgId: B.org, relation: "client-carrier", message: "HARNESS connect" })
        .returning({ id: partnerConnection.id });
    connectionsHere.push(request!.id);

    const [incoming, clients] = await Promise.all([
        partnersFor(B.user).list({ kind: "requests", direction: "incoming", pageSize: 100 }),
        partnersFor(B.user).list({ kind: "clients", pageSize: 100 }),
    ]);
    check("a request B has not answered is on its Requests, incoming, and not among its clients",
        incoming.items.some((row) => row.id === request!.id) && !clients.items.some((row) => row.id === request!.id), { incoming: incoming.items.map((row) => row.id) });

    for (const [company, orgType] of [[A, "shipper"], [B, "carrier"]] as const) {
        const partners = partnersFor(company.user);
        const stats = await partners.stats();

        for (const kind of kindsFor(orgType)) {
            const list = await partners.list({ kind, pageSize: 100 });
            const relation = relationForKind(orgType, kind);
            const fits = list.items.every((row) => (relation ? row.status === "accepted" && row.relation === relation : row.status === "pending"));

            check(`a ${orgType}'s ${kind}: what its pill counts, and only that`, list.total === countForKind(orgType, kind, stats) && fits,
                { total: list.total, count: countForKind(orgType, kind, stats), rows: list.items.map((row) => [row.relation, row.status]) });
        }
    }

    await expectError("a shipper has no clients list", () => partnersFor(A.user).list({ kind: "clients" }), "NOT_FOUND");
}

migratedData()
    .then(main)
    .then(hardening)
    .then(palette)
    .then(reviewedSlots)
    .then(manualChain)
    .then(roleGate)
    .then(quota)
    .then(propagation)
    .then(disputes)
    .then(tracking)
    .then(receivedOffer)
    .then(sectionsAndTabs)
    .then(photosAtLoading)
    .then(partnerLists)
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


