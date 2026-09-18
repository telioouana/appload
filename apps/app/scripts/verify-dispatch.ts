/**
 * End-to-end check of the dispatch papers and the loading check (design §7),
 * driven against the SHARED DEV DATABASE through the real doors: the portal
 * routers as two companies with an explicit tenant context each, and the
 * shared transition door as Appload staff — nobody is signed in, and every
 * gate resolves live exactly as it does behind the HTTP handler.
 *
 * It builds its own little world — a shipper, a carrier that Appload has
 * verified, a driver and a truck the carrier registers itself — and walks an
 * order from the offer that books it to the load that starts: the dispatch
 * refused while the rig has no papers, the papers filed from the portal, the
 * truck sent with the order marked unreviewed, the pack it left with, the
 * resume that must not write a second one, the load that starts unchecked,
 * the mismatch the client records and the manager who lets it go anyway.
 *
 * Every row it writes — down to the organizations and the accounts — is
 * counted before it goes and deleted at the end, pass or fail.
 *
 * Run from apps/app (the react-server condition turns `server-only` into the
 * no-op it is inside a server render; tsx is not a dependency):
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/verify-dispatch.ts
 */
import fs from "node:fs";

import { and, count, desc, eq, inArray } from "drizzle-orm";

import { activityLog } from "@workspace/db/activity-log";
import { chatConversation } from "@workspace/db/chats";
import { partnerConnection } from "@workspace/db/connections";
import { db } from "@workspace/db/db";
import { driver, truck } from "@workspace/db/fleet";
import { kycDocument } from "@workspace/db/kyc-documents";
import { movement, movementEvent } from "@workspace/db/movements";
import { notification } from "@workspace/db/notifications";
import {
    order,
    orderDispatch,
    orderDispatchDocument,
    orderDocument,
    orderHistory,
    orderLoadingCheck,
    orderOffer,
    sheetSync,
} from "@workspace/db/orders";
import { orderRequest } from "@workspace/db/quotes";
import { subscriptionUsage } from "@workspace/db/subscriptions";
import { ORDER_STATUS } from "@workspace/db/types";
import { member, organization, user } from "@workspace/db/users";

import { auth } from "@workspace/auth/server";

import type { Actor } from "@workspace/domain/orders/actor";
import { isDispatchMove } from "@workspace/domain/orders/dispatch-readiness";
import { applyTransition } from "@workspace/domain/orders/transition";
import { parseFlagReason } from "@workspace/domain/kyc/flag-reason";
import { isKycUrl } from "@workspace/domain/kyc/file-access";
import { tenantCanReadKycDocument } from "@workspace/domain/kyc/tenant-access";
import { TRACKED_STATUSES } from "@workspace/domain/tracking/statuses";

import { getStaffGates } from "@workspace/trpc/staff-gate";
import { getTenantGates } from "@workspace/trpc/tenant-gate";
import { createCallerFactory } from "@workspace/trpc/init";

// The whole router, not one page's: importing it registers the activity
// catalogs at module scope, which is what puts `loadingCheck` on the log row
import { appRouter } from "@/backend/api/routers/_app";

process.env.DATABASE_URL ??= fs.readFileSync("../admin/.env", "utf8").match(/^DATABASE_URL=(.+)$/m)![1]!.trim();

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`;
// Scoped to the run, so two harnesses can never clear each other's trail
const SESSION_ID = `verify-dispatch-${RUN}`;
const TAG = `HARNESS DISPATCH ${RUN}`;

const createCaller = createCallerFactory(appRouter);

/** Activity-log writes are fire-and-forget; this is where they are caught. */
const logged: Promise<unknown>[] = [];

const as = (userId: string) =>
    createCaller({
        authApi: auth.api,
        session: { user: { id: userId, name: TAG }, session: { id: SESSION_ID, userId } } as never,
        db,
        app: "portal",
        headers: new Headers(),
        waitUntil: (promise: Promise<unknown>) => logged.push(promise),
        staffGates: (id: string) => getStaffGates(db, { userId: id }),
        tenantGates: (id: string) => getTenantGates(db, { userId: id }),
    });

/** The shared order door as Appload, with the role the gates read. */
const staff = (userId: string, role: "user" | "manager") => ({
    db,
    actor: { kind: "staff", userId, role } as Actor,
    sheets: "defer" as const,
});

/** A stranger to everything below: an existing portal tenant with no part in it. */
const STRANGER = { user: "kU9US5NBPjNtS5HsSQBW3ZfEZvj7GQSm", org: "49db92eb-c131-467e-8bfc-fe42a7dcc149" };

const loading = { address: "Nampula, Mozambique", placeId: "ChIJOaE2a7M1xhgRdN3KTEt2F8I", country: "Mozambique", state: "Nampula Province" };
const offloading = { address: "Maputo, Mozambique", placeId: "ChIJ93KwEyKZ5h4RH3-hOGmXzMg", country: "Mozambique", state: "Maputo" };

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

// ---------------------------------------------------------------------------
// What the run created, so that it can be counted and taken away again
// ---------------------------------------------------------------------------

const madeUsers: string[] = [];
const madeOrgs: string[] = [];
const madeMembers: string[] = [];
const madeConnections: string[] = [];
const madeKycDocs: string[] = [];
const madeDrivers: string[] = [];
const madeTrucks: string[] = [];
/** Order primary keys, and the display ids the notifications hang off */
const madeOrders: string[] = [];
const madeOrderIds: string[] = [];
/**
 * The loads an Appload order opens in a portal company's own books. The two
 * companies here were made by this run and nobody has activated the portal
 * for them, so there should never be one — which is worth counting rather
 * than assuming, since the order doors open them without being asked.
 */
const madeLinks: string[] = [];

/** Takes note of any linked load our orders have opened, once each. */
async function noteLinkedLoads() {
    if (madeOrders.length === 0) return;

    const rows = await db.select({ id: movement.id }).from(movement).where(inArray(movement.orderId, madeOrders));

    for (const row of rows) if (!madeLinks.includes(row.id)) madeLinks.push(row.id);
}

/**
 * A page URL of our own KYC bucket, shaped the way EdgeStore builds it from
 * the bucket's `.path()` entries — which is exactly what `isKycUrl` reads
 * back before a page is stored or served. Asserted below rather than
 * assumed: a fixture the gate would refuse would make the upload check
 * meaningless.
 */
const kycPageUrl = (subjectType: string, subjectId: string, type: string, ext: string) =>
    `https://files.edgestore.dev/bdf53w7xn42a844s/kycFiles/_public/${subjectType}/${subjectId}/${type}/${crypto.randomUUID()}.${ext}`;

/** One portal company with its owner: the account, the organization, the membership. */
async function makeCompany(kind: "shipper" | "carrier", label: string) {
    const userId = `harness-dispatch-${RUN}-${kind}`;
    const orgId = crypto.randomUUID();
    // nuit, email and phone are unique columns: drawn rather than derived so
    // two runs at once cannot land on the same one
    const digits = `${Math.floor(Math.random() * 1e9)}`.padStart(9, "0");
    const suffix = `${RUN}${kind === "shipper" ? 1 : 2}`;

    await db.insert(user).values({
        id: userId,
        name: `${TAG} ${label} owner`,
        email: `harness-dispatch-${suffix}@appload.invalid`,
        emailVerified: true,
        type: kind,
        status: "active",
    });
    madeUsers.push(userId);

    await db.insert(organization).values({
        id: orgId,
        name: `${TAG} ${label}`,
        slug: `harness-dispatch-${suffix}`,
        createdAt: new Date(),
        // Booking and dispatching both spend a plan's monthly allowance
        subscriptionPlan: "business",
        nuit: `${digits.slice(0, 8)}${kind === "shipper" ? 1 : 2}`,
        type: kind,
        status: "active",
        email: `harness-dispatch-org-${suffix}@appload.invalid`,
        phoneNumber: `+2588${digits.slice(0, 6)}${kind === "shipper" ? 1 : 2}`,
        // The carrier is one Appload has already verified: without that the
        // dispatch would be flagged for the carrier's own paperwork and the
        // rig's would never be the reason on the row
        ...(kind === "carrier" && { kycStatus: "verified" as const }),
    });
    madeOrgs.push(orgId);

    const membershipId = crypto.randomUUID();

    await db.insert(member).values({
        id: membershipId,
        organizationId: orgId,
        userId,
        role: "owner",
        createdAt: new Date(),
    });
    madeMembers.push(membershipId);

    return { user: userId, org: orgId };
}

/** An Appload account to act as, with the role passed to the door per call. */
async function makeStaff(label: string) {
    const userId = `harness-dispatch-${RUN}-${label}`;

    await db.insert(user).values({
        id: userId,
        name: `${TAG} ${label}`,
        email: `harness-dispatch-${RUN}-${label}@appload.invalid`,
        emailVerified: true,
        type: "appload",
        status: "active",
    });
    madeUsers.push(userId);

    return userId;
}

/**
 * The order the whole check runs on, taken to "booked" the only way an
 * Appload order can be booked: the client asks, the carrier quotes, the
 * client accepts — which is `applyTransition` to "booked" with that offer.
 */
async function bookedOrder(shipper: string, carrier: string, carrierOrg: string, description: string) {
    const sh = as(shipper);
    const ca = as(carrier);

    const { orderId } = await sh.orders.create({
        loadingAddress: loading,
        expectedLoadingDate: new Date(Date.now() + 86_400_000),
        offloadingAddress: offloading,
        distance: 2100,
        routeType: "national",
        category: "general-cargo",
        description: `${TAG} ${description}`,
        weight: 30,
        weightUnit: "ton",
        loadType: "dedicated",
    });

    const [row] = await db.select({ id: order.id }).from(order).where(eq(order.orderId, orderId));
    madeOrders.push(row!.id);
    madeOrderIds.push(orderId);

    await sh.orders.sendRequests({ orderId, carrierOrgIds: [carrierOrg] });

    const offer = await ca.orders.offers.create({
        orderId,
        values: { fiscalRegime: "normal", total: 50_000, currency: "MZN" },
    });

    const placed = await sh.orders.get({ orderId });
    const booked = await sh.orders.offers.accept({ orderId, offerId: offer.id, expectedVersion: placed.version });

    return { orderId, pk: row!.id, version: booked.version };
}

/** The order row itself: the flag and the version are not on every payload. */
async function orderRow(orderId: string) {
    const [row] = await db
        .select({
            status: order.status,
            version: order.version,
            flaggedForReview: order.flaggedForReview,
            flagReason: order.flagReason,
            truckPlate: order.truckPlate,
            driverId: order.driverId,
        })
        .from(order)
        .where(eq(order.orderId, orderId));

    return row!;
}

/** The open dispatch packs of an order — there must never be two. */
const packsOf = (orderPk: string) =>
    db.select().from(orderDispatch).where(eq(orderDispatch.orderId, orderPk)).orderBy(desc(orderDispatch.dispatchedAt));

/** The check rows the timeline carries for an order, newest first. */
const checkRows = (orderPk: string) =>
    db
        .select({ metadata: orderHistory.metadata })
        .from(orderHistory)
        .where(and(eq(orderHistory.orderId, orderPk), eq(orderHistory.kind, "check")))
        .orderBy(desc(orderHistory.createdAt));

async function main() {
    console.log(`\n— the cast: two companies, an Appload desk, a driver and a truck (${TAG})`);

    const shipper = await makeCompany("shipper", "Cliente");
    const carrier = await makeCompany("carrier", "Transportadora");
    const ops = await makeStaff("ops");
    const manager = await makeStaff("manager");

    const [connection] = await db
        .insert(partnerConnection)
        .values({
            requesterOrgId: shipper.org,
            targetOrgId: carrier.org,
            relation: "client-carrier",
            status: "accepted",
            acceptedVia: "staff",
            message: `${TAG} connection`,
        })
        .returning({ id: partnerConnection.id });
    madeConnections.push(connection!.id);

    // A verified carrier is one whose signed contract is on file and approved:
    // without it `carrierEligibility` refuses the booking outright, and the
    // dispatch flag would name the carrier rather than the rig
    const [contract] = await db
        .insert(kycDocument)
        .values({
            subjectType: "organization",
            subjectId: carrier.org,
            type: "signed-contract",
            pages: [{ url: kycPageUrl("organization", carrier.org, "signed-contract", "pdf"), mimeType: "application/pdf" }],
            status: "approved",
            expiresAt: "2099-12-31",
            reviewedBy: manager,
            reviewedAt: new Date(),
            uploadedBy: manager,
        })
        .returning({ id: kycDocument.id });
    madeKycDocs.push(contract!.id);

    const sh = as(shipper.user);
    const ca = as(carrier.user);

    const registered = await ca.drivers.register({
        name: `${TAG} Motorista`,
        phoneNumber: `+25884${`${Math.floor(Math.random() * 1e7)}`.padStart(7, "0")}`,
    });
    madeDrivers.push(registered.id);

    const [driverRow] = await db.select({ userId: driver.userId }).from(driver).where(eq(driver.id, registered.id));
    madeUsers.push(driverRow!.userId);

    const rig = await ca.fleet.vehicles.register({
        kind: "truck",
        regPlate: `HD${RUN.slice(-4).toUpperCase()}MP`,
        brand: "Scania",
        model: "R450",
        year: 2020,
        vin: `HARNESS${RUN.toUpperCase()}`.padEnd(17, "X").slice(0, 17).replace(/[IOQ]/g, "X"),
        type: "articulated",
    });
    madeTrucks.push(rig.id);

    check("the carrier registered a driver and a truck of its own",
        Boolean(registered.id && rig.id), { driver: registered.id, truck: rig.id });
    check("the fixture page URL is one the KYC gate accepts",
        isKycUrl(kycPageUrl("driver", registered.id, "driver-license", "jpg"), "driver", registered.id));

    console.log("\n— the client files an order and the carrier wins it");
    const first = await bookedOrder(shipper.user, carrier.user, carrier.org, "milho, 30t");

    let row = await orderRow(first.orderId);
    check("the accepted offer booked the order", row.status === "booked", row.status);
    check("…and a verified carrier left nothing to flag", !row.flaggedForReview && row.flagReason === null, row);

    console.log("\n— the dispatch: refused while the rig has no papers");
    let options = await ca.orders.transitionOptions({ orderId: first.orderId });
    const dispatchTarget = options.targets.find((target) => target.to === "at-loading");

    check("the way on from booked is the loading site", Boolean(dispatchTarget), options.targets.map((target) => target.to));
    check("…which is the one edge the code calls a dispatch",
        isDispatchMove("booked", "at-loading") && !isDispatchMove("stopped", "at-loading"));

    await expectError("a truck whose driver has no licence is refused at the gate", () =>
        ca.orders.transition({
            orderId: first.orderId,
            to: "at-loading",
            expectedVersion: options.version,
            dispatch: { driverId: registered.id, truckId: rig.id },
        }), "PAPERS_MISSING");

    row = await orderRow(first.orderId);
    check("…and the refused move left no rig on the order",
        row.status === "booked" && row.driverId === null && row.truckPlate === null, row);

    console.log("\n— the carrier files the papers itself, from the portal");
    const licence = await ca.kyc.upload({
        subjectType: "driver",
        subjectId: registered.id,
        type: "driver-license",
        pages: [{ url: kycPageUrl("driver", registered.id, "driver-license", "jpg"), mimeType: "image/jpeg" }],
        expiresAt: "2099-01-31",
    });
    madeKycDocs.push(licence.document.id);

    const booklet = await ca.kyc.upload({
        subjectType: "truck",
        subjectId: rig.id,
        type: "vehicle-booklet",
        pages: [{ url: kycPageUrl("truck", rig.id, "vehicle-booklet", "pdf"), mimeType: "application/pdf" }],
    });
    madeKycDocs.push(booklet.document.id);

    check("a paper filed by the carrier lands waiting for Appload",
        licence.document.status === "pending" && booklet.document.status === "pending",
        { licence: licence.document.status, booklet: booklet.document.status });

    await expectError("…and a page URL that is not this subject's is refused", () =>
        ca.kyc.upload({
            subjectType: "truck",
            subjectId: rig.id,
            type: "vehicle-booklet",
            pages: [{ url: kycPageUrl("truck", "somebody-else", "vehicle-booklet", "pdf") }],
        }), "INVALID_DOCUMENT_URL");

    console.log("\n— the truck goes, and the order says nobody has looked at its papers");
    options = await ca.orders.transitionOptions({ orderId: first.orderId });
    const dispatched = await ca.orders.transition({
        orderId: first.orderId,
        to: "at-loading",
        expectedVersion: options.version,
        dispatch: { driverId: registered.id, truckId: rig.id },
    });

    check("the dispatch goes through once the papers are in", dispatched.status === "at-loading", dispatched);

    row = await orderRow(first.orderId);
    const flag = parseFlagReason(row.flagReason ?? "");
    check("…with the order flagged as unreviewed rather than unpapered",
        row.flaggedForReview && flag.code === "PAPERS_UNREVIEWED", { flagged: row.flaggedForReview, reason: row.flagReason });
    check("…naming the driver and the plate it is waiting on",
        Boolean(flag.detail?.includes(`${TAG} Motorista`) && flag.detail.includes(rig.regPlate)), flag.detail);
    check("…and the rig is on the order", row.driverId === registered.id && row.truckPlate === rig.regPlate, row);

    let packs = await packsOf(first.pk);
    check("one dispatch pack was written, and it is open",
        packs.length === 1 && packs[0]?.supersededAt === null, packs.map((pack) => pack.id));
    check("…snapshotting who and what left", packs[0]?.driverId === registered.id
        && packs[0]?.truckId === rig.id && packs[0]?.truckPlate === rig.regPlate, packs[0]);

    const packDocs = await db
        .select()
        .from(orderDispatchDocument)
        .where(eq(orderDispatchDocument.dispatchId, packs[0]!.id));

    check("…with the papers that were on file at that moment",
        packDocs.length === 2
        && packDocs.some((doc) => doc.subjectType === "driver" && doc.type === "driver-license" && doc.kycDocumentId === licence.document.id)
        && packDocs.some((doc) => doc.subjectType === "truck" && doc.type === "vehicle-booklet" && doc.kycDocumentId === booklet.document.id),
        packDocs.map((doc) => [doc.subjectType, doc.type, doc.statusAtSnapshot]));
    check("…recorded as pending, which is what they were", packDocs.every((doc) => doc.statusAtSnapshot === "pending"), packDocs);

    const [billed] = await db
        .select({ value: count() })
        .from(subscriptionUsage)
        .where(and(
            eq(subscriptionUsage.organizationId, carrier.org),
            eq(subscriptionUsage.entityType, "order"),
            eq(subscriptionUsage.entityId, first.pk),
        ));
    check("the carrier's plan paid for this trip exactly once", billed?.value === 1, billed);

    console.log("\n— the status that was retired, and the tracking that has not started");
    check("'to-loading' is gone from the vocabulary", !(ORDER_STATUS as readonly string[]).includes("to-loading"), ORDER_STATUS);

    const offered = new Set<string>();

    for (const [who, caller] of [["carrier", ca], ["shipper", sh]] as const) {
        const view = await caller.orders.transitionOptions({ orderId: first.orderId });
        for (const target of view.targets) offered.add(`${who}:${target.to}`);
    }

    check("no dialog is ever offered 'to-loading'", ![...offered].some((entry) => entry.endsWith(":to-loading")), [...offered]);
    check("a truck at the loading site is not one the cron pings",
        !TRACKED_STATUSES.includes("at-loading") && TRACKED_STATUSES.includes("on-route"), TRACKED_STATUSES);

    console.log("\n— a stop at the gate, and the resume that must not re-dispatch");
    let live = await ca.orders.transitionOptions({ orderId: first.orderId });
    const stopped = await ca.orders.transition({
        orderId: first.orderId,
        to: "stopped",
        expectedVersion: live.version,
        note: `${TAG} gate closed`,
    });
    const resumed = await ca.orders.transition({
        orderId: first.orderId,
        to: "at-loading",
        expectedVersion: stopped.version,
    });

    check("the trip parks and comes back to the loading site", resumed.status === "at-loading", resumed);

    packs = await packsOf(first.pk);
    check("…on the pack it already had: a resume is not a dispatch",
        packs.length === 1 && packs[0]?.supersededAt === null, packs.map((pack) => [pack.id, pack.supersededAt]));

    console.log("\n— the load starts with nobody having checked it");
    live = await ca.orders.transitionOptions({ orderId: first.orderId });
    const start = live.targets.find((target) => target.to === "loading");
    check("loading is offered, unblocked, with nothing checked yet",
        start?.blocked === false && start.loadingCheck?.state === "none", start);

    const unchecked = await ca.orders.transition({ orderId: first.orderId, to: "loading", expectedVersion: live.version });
    check("…and the move goes through", unchecked.status === "loading", unchecked);
    check("…carrying what the check said", unchecked.loadingCheck === "none", unchecked);

    row = await orderRow(first.orderId);
    check("…with the order flagged as unchecked",
        parseFlagReason(row.flagReason ?? "").code === "LOADING_CHECK_SKIPPED", row.flagReason);

    let checks = await checkRows(first.pk);
    const skipped = checks.find((entry) => (entry.metadata as { skipped?: boolean }).skipped === true);
    check("…and its own line on the timeline", Boolean(skipped), checks.map((entry) => entry.metadata));
    check("…remembering the reason it replaced",
        (skipped?.metadata as { previousFlagReason?: string })?.previousFlagReason?.startsWith("PAPERS_UNREVIEWED") ?? false,
        skipped?.metadata);

    await Promise.all(logged.splice(0));

    const [logRow] = await db
        .select({ params: activityLog.params })
        .from(activityLog)
        .where(and(
            eq(activityLog.sessionId, SESSION_ID),
            eq(activityLog.action, "orders.transition"),
            eq(activityLog.entityId, first.orderId),
        ))
        .orderBy(desc(activityLog.createdAt))
        .limit(1);

    check("the audit row for the move names what the check said",
        (logRow?.params as { to?: string; loadingCheck?: string })?.to === "loading"
        && (logRow?.params as { loadingCheck?: string })?.loadingCheck === "none", logRow?.params);

    console.log("\n— Appload sends the truck back to the gate, and the client looks at it");
    row = await orderRow(first.orderId);
    await applyTransition(staff(manager, "manager"), {
        orderId: first.orderId,
        to: "at-loading",
        expectedVersion: row.version,
        note: `${TAG} re-check the rig at the gate`,
    });

    packs = await packsOf(first.pk);
    check("a correction backwards writes no pack either", packs.length === 1, packs.map((pack) => pack.id));

    const beforeCheck = await sh.orders.get({ orderId: first.orderId });
    const mismatch = await sh.orders.recordLoadingCheck({
        orderId: first.orderId,
        expectedVersion: beforeCheck.version,
        items: [
            { key: "driver-identity", ok: false, note: `${TAG} another man at the wheel` },
            { key: "rig-plates", ok: true },
        ],
        note: `${TAG} plates match, the driver does not`,
    });

    check("the client's check reads as a mismatch", mismatch.outcome === "mismatch", mismatch);

    row = await orderRow(first.orderId);
    const mismatchFlag = parseFlagReason(row.flagReason ?? "");
    check("…and the order carries it, with what failed",
        mismatchFlag.code === "LOADING_MISMATCH" && mismatchFlag.detail === "driver-identity", row.flagReason);

    checks = await checkRows(first.pk);
    check("…on the timeline as a check of its own",
        checks.some((entry) => (entry.metadata as { outcome?: string }).outcome === "mismatch"),
        checks.map((entry) => entry.metadata));

    const carrierView = await ca.orders.loadingCheck({ orderId: first.orderId });
    check("the carrier reads the pack and the verdict about its own truck",
        carrierView.pack?.id === packs[0]?.id && carrierView.state.state === "mismatch", carrierView.state);
    check("…but is never the one who checks", carrierView.canCheck === false, carrierView.canCheck);

    console.log("\n— who may let a mismatched load start");
    live = await ca.orders.transitionOptions({ orderId: first.orderId });
    const blocked = live.targets.find((target) => target.to === "loading");
    check("the carrier is shown the refusal before it tries",
        blocked?.blockedReason === "LOADING_MISMATCH_REVIEW_REQUIRED", blocked);

    await expectError("…and the door refuses it too", () =>
        ca.orders.transition({ orderId: first.orderId, to: "loading", expectedVersion: live.version }),
        "LOADING_MISMATCH_REVIEW_REQUIRED");

    row = await orderRow(first.orderId);
    await expectError("an Appload desk without the risk flag cannot clear it either", () =>
        applyTransition(staff(ops, "user"), { orderId: first.orderId, to: "loading", expectedVersion: row.version }),
        "MANAGER_REQUIRED");

    await expectError("…and a manager has to say why", () =>
        applyTransition(staff(manager, "manager"), { orderId: first.orderId, to: "loading", expectedVersion: row.version }),
        "NOTE_REQUIRED");

    const cleared = await applyTransition(staff(manager, "manager"), {
        orderId: first.orderId,
        to: "loading",
        expectedVersion: row.version,
        note: `${TAG} client confirmed the substitution by phone`,
    });

    check("a manager with a reason lets the load start", cleared.order.status === "loading", cleared.order.status);
    check("…and the move records what it went ahead of", cleared.loadingCheck === "mismatch", cleared.loadingCheck);

    console.log("\n— a second order, checked and passed, moves with nothing added against it");
    const second = await bookedOrder(shipper.user, carrier.user, carrier.org, "cimento, 28t");

    let secondOptions = await ca.orders.transitionOptions({ orderId: second.orderId });
    await ca.orders.transition({
        orderId: second.orderId,
        to: "at-loading",
        expectedVersion: secondOptions.version,
        dispatch: { driverId: registered.id, truckId: rig.id },
    });

    const dispatchedFlag = (await orderRow(second.orderId)).flagReason;

    const secondDetail = await sh.orders.get({ orderId: second.orderId });
    const passed = await sh.orders.recordLoadingCheck({
        orderId: second.orderId,
        expectedVersion: secondDetail.version,
        items: [{ key: "driver-identity", ok: true }, { key: "rig-plates", ok: true }],
    });
    check("a complete set of yeses passes", passed.outcome === "passed", passed);

    secondOptions = await ca.orders.transitionOptions({ orderId: second.orderId });
    const clean = await ca.orders.transition({ orderId: second.orderId, to: "loading", expectedVersion: secondOptions.version });

    check("the carrier starts the load itself", clean.status === "loading" && clean.loadingCheck === "passed", clean);

    const secondRow = await orderRow(second.orderId);
    check("…and the move added no flag of its own", secondRow.flagReason === dispatchedFlag, { before: dispatchedFlag, after: secondRow.flagReason });
    check("…nor a skipped line on the timeline",
        !(await checkRows(second.pk)).some((entry) => (entry.metadata as { skipped?: boolean }).skipped === true));

    console.log("\n— the boundaries");
    const secondLive = await sh.orders.get({ orderId: second.orderId });

    // Refused for the side it stands on, not for the kind of company it is: a
    // transporter is the client of the order it hands to Appload, and runs
    // that one's check
    await expectError("the carrier cannot run the check on itself", () =>
        ca.orders.recordLoadingCheck({
            orderId: second.orderId,
            expectedVersion: secondLive.version,
            items: [{ key: "driver-identity", ok: true }, { key: "rig-plates", ok: true }],
        }), "NOT_ALLOWED_FOR_ACTOR");

    await expectError("a company with no part in the order reads nothing of the check", () =>
        as(STRANGER.user).orders.loadingCheck({ orderId: first.orderId }), "NOT_FOUND");

    const licenceRef = { id: licence.document.id, subjectType: "driver" as const, subjectId: registered.id };

    check("the client of a dispatched order may open its driver's licence",
        await tenantCanReadKycDocument(db, shipper.org, licenceRef));
    check("…so may the carrier it belongs to",
        await tenantCanReadKycDocument(db, carrier.org, licenceRef));
    check("…and nobody else", !(await tenantCanReadKycDocument(db, STRANGER.org, licenceRef)));
}

// ---------------------------------------------------------------------------
// Cleanup: counted first, then taken away, then counted again
// ---------------------------------------------------------------------------

/** How many rows of ours each table still holds. */
async function census(): Promise<Record<string, number>> {
    await noteLinkedLoads();

    const tally = async (
        label: string,
        ids: string[],
        run: (ids: string[]) => Promise<{ value: number }[]>,
    ) => [label, ids.length === 0 ? 0 : (await run(ids))[0]?.value ?? 0] as const;

    const entries = await Promise.all([
        tally("orders", madeOrders, async (ids) => db.select({ value: count() }).from(order).where(inArray(order.id, ids))),
        tally("offers", madeOrders, async (ids) => db.select({ value: count() }).from(orderOffer).where(inArray(orderOffer.orderId, ids))),
        tally("requests", madeOrders, async (ids) => db.select({ value: count() }).from(orderRequest).where(inArray(orderRequest.orderId, ids))),
        tally("history", madeOrders, async (ids) => db.select({ value: count() }).from(orderHistory).where(inArray(orderHistory.orderId, ids))),
        tally("documents", madeOrders, async (ids) => db.select({ value: count() }).from(orderDocument).where(inArray(orderDocument.orderId, ids))),
        tally("dispatch", madeOrders, async (ids) => db.select({ value: count() }).from(orderDispatch).where(inArray(orderDispatch.orderId, ids))),
        tally("checks", madeOrders, async (ids) => db.select({ value: count() }).from(orderLoadingCheck).where(inArray(orderLoadingCheck.orderId, ids))),
        tally("sheet-sync", madeOrders, async (ids) => db.select({ value: count() }).from(sheetSync).where(inArray(sheetSync.orderId, ids))),
        tally("linked-loads", madeLinks, async (ids) => db.select({ value: count() }).from(movement).where(inArray(movement.id, ids))),
        tally("usage", madeOrders, async (ids) => db.select({ value: count() }).from(subscriptionUsage).where(and(eq(subscriptionUsage.entityType, "order"), inArray(subscriptionUsage.entityId, ids)))),
        tally("notifications", madeOrderIds, async (ids) => db.select({ value: count() }).from(notification).where(and(eq(notification.entityType, "order"), inArray(notification.entityId, ids)))),
        tally("activity", [SESSION_ID], async () => db.select({ value: count() }).from(activityLog).where(eq(activityLog.sessionId, SESSION_ID))),
        tally("activity-by-actor", madeUsers, async (ids) => db.select({ value: count() }).from(activityLog).where(inArray(activityLog.actorId, ids))),
        tally("driver-threads", madeOrderIds, async (ids) => db.select({ value: count() }).from(chatConversation).where(inArray(chatConversation.orderId, ids))),
        tally("kyc-documents", madeKycDocs, async (ids) => db.select({ value: count() }).from(kycDocument).where(inArray(kycDocument.id, ids))),
        tally("drivers", madeDrivers, async (ids) => db.select({ value: count() }).from(driver).where(inArray(driver.id, ids))),
        tally("trucks", madeTrucks, async (ids) => db.select({ value: count() }).from(truck).where(inArray(truck.id, ids))),
        tally("connections", madeConnections, async (ids) => db.select({ value: count() }).from(partnerConnection).where(inArray(partnerConnection.id, ids))),
        tally("members", madeMembers, async (ids) => db.select({ value: count() }).from(member).where(inArray(member.id, ids))),
        tally("organizations", madeOrgs, async (ids) => db.select({ value: count() }).from(organization).where(inArray(organization.id, ids))),
        tally("users", madeUsers, async (ids) => db.select({ value: count() }).from(user).where(inArray(user.id, ids))),
    ]);

    return Object.fromEntries(entries.filter(([, value]) => value > 0));
}

async function cleanup() {
    // Whatever the routers scheduled in the background, before anything it
    // writes to is deleted out from under it
    await Promise.allSettled(logged.splice(0));

    console.log("\nwrote:", JSON.stringify(await census()));

    if (madeOrderIds.length > 0) {
        // The thread's order link is a plain FK with no cascade
        await db.delete(chatConversation).where(inArray(chatConversation.orderId, madeOrderIds));
        await db.delete(notification).where(and(eq(notification.entityType, "order"), inArray(notification.entityId, madeOrderIds)));
    }

    // Before the orders, while the rows still point at them: the FK nulls the
    // link rather than taking the load with it
    if (madeLinks.length > 0) {
        await db.delete(movementEvent).where(inArray(movementEvent.movementId, madeLinks));
        await db.delete(movement).where(inArray(movement.id, madeLinks));
    }

    if (madeOrders.length > 0) {
        await db.delete(subscriptionUsage).where(and(eq(subscriptionUsage.entityType, "order"), inArray(subscriptionUsage.entityId, madeOrders)));
        await db.delete(orderLoadingCheck).where(inArray(orderLoadingCheck.orderId, madeOrders));
        // The pack's documents cascade off the pack itself
        await db.delete(orderDispatch).where(inArray(orderDispatch.orderId, madeOrders));
        await db.delete(orderHistory).where(inArray(orderHistory.orderId, madeOrders));
        await db.delete(orderDocument).where(inArray(orderDocument.orderId, madeOrders));
        await db.delete(sheetSync).where(inArray(sheetSync.orderId, madeOrders));
        // Offers and requests cascade off the order
        await db.delete(order).where(inArray(order.id, madeOrders));
    }

    await db.delete(activityLog).where(eq(activityLog.sessionId, SESSION_ID));
    // Better Auth logs the account it created under its own session id
    if (madeUsers.length > 0) await db.delete(activityLog).where(inArray(activityLog.actorId, madeUsers));

    if (madeKycDocs.length > 0) await db.delete(kycDocument).where(inArray(kycDocument.id, madeKycDocs));
    if (madeTrucks.length > 0) await db.delete(truck).where(inArray(truck.id, madeTrucks));
    if (madeDrivers.length > 0) await db.delete(driver).where(inArray(driver.id, madeDrivers));
    if (madeConnections.length > 0) await db.delete(partnerConnection).where(inArray(partnerConnection.id, madeConnections));
    if (madeMembers.length > 0) await db.delete(member).where(inArray(member.id, madeMembers));
    if (madeOrgs.length > 0) await db.delete(organization).where(inArray(organization.id, madeOrgs));
    // Sessions and accounts cascade off the account row
    if (madeUsers.length > 0) await db.delete(user).where(inArray(user.id, madeUsers));

    const left = await census();

    console.log("left behind:", JSON.stringify(left));
    check("every row the run wrote was taken away again", Object.keys(left).length === 0, left);
}

main()
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
