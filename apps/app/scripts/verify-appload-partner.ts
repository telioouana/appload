/**
 * End-to-end check of Appload as a partner on the portal (design §8 of
 * docs/appload-partner-design.md), driven against the SHARED DEV DATABASE
 * through the real doors: the portal routers as four companies with an
 * explicit tenant context each, and the shared order door as Appload staff.
 * Nobody is signed in; every gate resolves live exactly as it does behind
 * the HTTP handler.
 *
 * It builds a world of its own — a shipper S, two carriers C and D that
 * Appload has verified, a stranger, an Appload desk and a manager, C's own
 * driver and truck — and walks one load through the whole seam: filed with
 * the carrier "Appload", turned into an APPL order, sent out to C and D,
 * quoted, withdrawn, booked, un-booked, re-booked, dispatched, delivered,
 * completed and closed on both sides' own books — then the cancels, the
 * carrier that hands its OWN load over, the reference counters, the admin
 * sign-in rule and the company KYC uploads.
 *
 * Every row it writes — down to the organizations, their reference counters
 * and the accounts — is counted before it goes and deleted at the end, pass
 * or fail. The Appload seed row and its counters are never touched: the only
 * thing this run puts on Appload is one membership, to prove the tenant gate
 * refuses it, and that membership is deleted with everything else.
 *
 * Run from apps/app (the react-server condition turns `server-only` into the
 * no-op it is inside a server render; tsx is not a dependency):
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/verify-appload-partner.ts
 */
import fs from "node:fs";

import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { activityLog } from "@workspace/db/activity-log";
import { chatConversation, chatMessage, trackingRequest } from "@workspace/db/chats";
import { partnerConnection } from "@workspace/db/connections";
import { db } from "@workspace/db/db";
import { driver, truck } from "@workspace/db/fleet";
import { kycDocument } from "@workspace/db/kyc-documents";
import {
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
    organizationCounter,
} from "@workspace/db/movements";
import { notification } from "@workspace/db/notifications";
import {
    order,
    orderDispatch,
    orderDocument,
    orderHistory,
    orderLoadingCheck,
    orderOffer,
    sheetSync,
} from "@workspace/db/orders";
import { orderRequest } from "@workspace/db/quotes";
import { subscriptionUsage } from "@workspace/db/subscriptions";
import { APPLOAD_ORG_ID, APPLOAD_ORG_NAME } from "@workspace/db/types";
import { member, organization, user } from "@workspace/db/users";

import { auth } from "@workspace/auth/server";

import { linkedMovementId } from "@workspace/domain/appload/link";
import { loadSubject } from "@workspace/domain/kyc/subjects";
import { uploadKycDocument } from "@workspace/domain/kyc/upload";
import { referenceYear, nextReference } from "@workspace/domain/movements/counters";
import type { Actor } from "@workspace/domain/orders/actor";
import { applyTransition } from "@workspace/domain/orders/transition";
import { resolveMovementForConversation } from "@workspace/domain/tracking/movements";
import { normalizePhone } from "@workspace/comms/phone";

import { edgeStoreRouter } from "@workspace/edgestore/server";

import { getStaffGates } from "@workspace/trpc/staff-gate";
import { getTenantGates } from "@workspace/trpc/tenant-gate";
import { createCallerFactory } from "@workspace/trpc/init";

// The whole router, not one page's: importing it registers the activity
// catalogs at module scope, exactly as a cold start does
import { appRouter } from "@/backend/api/routers/_app";

process.env.DATABASE_URL ??= fs.readFileSync("../admin/.env", "utf8").match(/^DATABASE_URL=(.+)$/m)![1]!.trim();

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`;
// Scoped to the run, so two harnesses can never clear each other's trail
const SESSION_ID = `verify-appload-${RUN}`;
const TAG = `HARNESS APPLOAD ${RUN}`;

/** The two-digit year every reference this run mints is stamped with. */
const YY = String(referenceYear() % 100).padStart(2, "0");

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
 * A page URL of our own KYC bucket, shaped the way EdgeStore builds it from
 * the bucket's `.path()` entries — which is what `isKycUrl` reads back before
 * a page is stored.
 */
const kycPageUrl = (subjectType: string, subjectId: string, type: string, ext: string) =>
    `https://files.edgestore.dev/bdf53w7xn42a844s/kycFiles/_public/${subjectType}/${subjectId}/${type}/${crypto.randomUUID()}.${ext}`;

type Company = { user: string; org: string; name: string };

/** One portal company with its owner: the account, the organization, the membership. */
async function makeCompany(kind: "shipper" | "carrier", label: string, slot: number): Promise<Company> {
    const userId = `harness-appload-${RUN}-${label}`;
    const orgId = crypto.randomUUID();
    // nuit, email and phone are unique columns: drawn rather than derived so
    // two runs at once cannot land on the same one
    const digits = `${Math.floor(Math.random() * 1e9)}`.padStart(9, "0");
    const suffix = `${RUN}${slot}`;
    const name = `${TAG} ${label}`;

    await db.insert(user).values({
        id: userId,
        name: `${name} owner`,
        email: `harness-appload-${suffix}@appload.invalid`,
        emailVerified: true,
        type: kind,
        status: "active",
    });
    madeUsers.push(userId);

    await db.insert(organization).values({
        id: orgId,
        name,
        slug: `harness-appload-${suffix}`,
        createdAt: new Date(),
        // Handing a load over and booking one both spend a plan's allowance
        subscriptionPlan: "business",
        // The portal is where these companies answer: without it no linked
        // row is ever opened for them (D5)
        portalActivatedAt: new Date(),
        nuit: `${digits.slice(0, 8)}${slot}`,
        type: kind,
        status: "active",
        email: `harness-appload-org-${suffix}@appload.invalid`,
        phoneNumber: `+2588${digits.slice(0, 6)}${slot}`,
        // A carrier Appload has already verified: without that the booking
        // gate refuses the order outright
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

    return { user: userId, org: orgId, name };
}

/** An Appload account to act as, with the role passed to the door per call. */
async function makeStaff(label: string): Promise<string> {
    const userId = `harness-appload-${RUN}-${label}`;

    await db.insert(user).values({
        id: userId,
        name: `${TAG} ${label}`,
        email: `harness-appload-${RUN}-${label}@appload.invalid`,
        emailVerified: true,
        type: "appload",
        status: "active",
    });
    madeUsers.push(userId);

    return userId;
}

/** The signed contract a carrier cannot be booked without. */
async function approveContract(orgId: string, reviewer: string) {
    const [contract] = await db
        .insert(kycDocument)
        .values({
            subjectType: "organization",
            subjectId: orgId,
            type: "signed-contract",
            pages: [{ url: kycPageUrl("organization", orgId, "signed-contract", "pdf"), mimeType: "application/pdf" }],
            status: "approved",
            expiresAt: "2099-12-31",
            reviewedBy: reviewer,
            reviewedAt: new Date(),
            uploadedBy: reviewer,
        })
        .returning({ id: kycDocument.id });

    madeKycDocs.push(contract!.id);
}

/** An accepted client-carrier connection, the only thing a request may be sent down. */
async function connect(clientOrg: string, carrierOrg: string) {
    const [row] = await db
        .insert(partnerConnection)
        .values({
            requesterOrgId: clientOrg,
            targetOrgId: carrierOrg,
            relation: "client-carrier",
            status: "accepted",
            acceptedVia: "staff",
            message: `${TAG} connection`,
        })
        .returning({ id: partnerConnection.id });

    madeConnections.push(row!.id);
}

// ---------------------------------------------------------------------------
// Reading what the doors wrote
// ---------------------------------------------------------------------------

/** One load's stored row — the columns the projections deliberately hide. */
async function loadRow(id: string) {
    const [row] = await db
        .select({
            id: movement.id,
            organizationId: movement.organizationId,
            orderId: movement.orderId,
            execution: movement.execution,
            status: movement.status,
            reference: movement.reference,
            requestReference: movement.requestReference,
            clientReference: movement.clientReference,
            clientOrgId: movement.clientOrgId,
            clientName: movement.clientName,
            carrierOrgId: movement.carrierOrgId,
            buyTotal: movement.buyTotal,
            sellTotal: movement.sellTotal,
            driverName: movement.driverName,
            driverPhone: movement.driverPhone,
            truckPlate: movement.truckPlate,
            startedAt: movement.startedAt,
            trackingEnabled: movement.trackingEnabled,
            version: movement.version,
        })
        .from(movement)
        .where(eq(movement.id, id));

    return row!;
}

/** This company's live row on an order, whatever the door called it. */
async function rowOf(orderPk: string, organizationId: string) {
    const [row] = await db
        .select({ id: movement.id })
        .from(movement)
        .where(and(
            eq(movement.orderId, orderPk),
            eq(movement.organizationId, organizationId),
            ne(movement.status, "cancelled"),
        ))
        .limit(1);

    return row ? loadRow(row.id) : null;
}

/** Every row this company ever held on an order, newest first. */
async function rowsOf(orderPk: string, organizationId: string) {
    const rows = await db
        .select({ id: movement.id })
        .from(movement)
        .where(and(eq(movement.orderId, orderPk), eq(movement.organizationId, organizationId)))
        .orderBy(desc(movement.createdAt));

    return Promise.all(rows.map((row) => loadRow(row.id)));
}

/** The order row itself: the version and the money are not on every payload. */
async function orderRow(orderId: string) {
    const [row] = await db.select().from(order).where(eq(order.orderId, orderId));
    return row!;
}

/** The order a load was put on, registered for cleanup the first time it is seen. */
async function orderBehind(loadId: string) {
    const row = await loadRow(loadId);
    const [found] = await db.select().from(order).where(eq(order.id, row.orderId!));

    if (found && !madeOrders.includes(found.id)) {
        madeOrders.push(found.id);
        madeOrderIds.push(found.orderId);
    }

    return found!;
}

/** Moves the order along its chain as Appload, one transition each. */
async function walk(actor: ReturnType<typeof staff>, orderId: string, steps: readonly string[]) {
    for (const to of steps) {
        const row = await orderRow(orderId);
        await applyTransition(actor, { orderId, to: to as never, expectedVersion: row.version });
    }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const cast = {
    shipper: null as unknown as Company,
    carrier: null as unknown as Company,
    other: null as unknown as Company,
    stranger: null as unknown as Company,
    ops: "",
    manager: "",
};

/** The main load and the order behind it, shared by the sections below. */
const main = { load: "", orderPk: "", orderId: "", carrierRow: "" };

async function world() {
    console.log(`\n— the cast: a shipper, two carriers, a stranger and an Appload desk (${TAG})`);

    cast.shipper = await makeCompany("shipper", "Cliente", 1);
    cast.carrier = await makeCompany("carrier", "Transportadora", 2);
    cast.other = await makeCompany("carrier", "Concorrente", 3);
    cast.stranger = await makeCompany("shipper", "Estranho", 4);
    cast.ops = await makeStaff("ops");
    cast.manager = await makeStaff("manager");

    // C is the one that gets booked, so it is the one whose contract has to
    // be on file; D only ever quotes, and files its contract at the end
    await approveContract(cast.carrier.org, cast.manager);

    await connect(cast.shipper.org, cast.carrier.org);
    await connect(cast.shipper.org, cast.other.org);

    const c = as(cast.carrier.user);

    const registered = await c.drivers.register({
        name: `${TAG} Motorista`,
        phoneNumber: `+25884${`${Math.floor(Math.random() * 1e7)}`.padStart(7, "0")}`,
    });
    madeDrivers.push(registered.id);

    const [driverRow] = await db
        .select({ userId: driver.userId, phone: user.phoneNumber })
        .from(driver)
        .innerJoin(user, eq(user.id, driver.userId))
        .where(eq(driver.id, registered.id));
    madeUsers.push(driverRow!.userId);

    const rig = await c.fleet.vehicles.register({
        kind: "truck",
        regPlate: `HA${RUN.slice(-4).toUpperCase()}MP`,
        brand: "Scania",
        model: "R450",
        year: 2020,
        vin: `HARNESS${RUN.toUpperCase()}`.padEnd(17, "X").slice(0, 17).replace(/[IOQ]/g, "X"),
        type: "articulated",
    });
    madeTrucks.push(rig.id);

    check("the carrier registered a driver and a truck of its own",
        Boolean(registered.id && rig.id), { driver: registered.id, truck: rig.id });

    return { driverId: registered.id, driverPhone: driverRow!.phone!, truckId: rig.id, plate: rig.regPlate };
}

/** §8 — the seeded organization, and everything that must never treat it as a tenant. */
async function seedGuard() {
    console.log("\n— the seed: Appload is a partner row, never an account");

    const [row] = await db.select().from(organization).where(eq(organization.id, APPLOAD_ORG_ID));

    check("Appload's own organization is seeded", Boolean(row), row?.id);
    check("…with the type that is not a tenant's", row?.type === "appload", row?.type);
    check("…and the portal marked active, so linked rows are opened for it",
        row?.portalActivatedAt !== null, row?.portalActivatedAt);

    // A partner account made a member of Appload: the account type passes,
    // the organization type is what has to refuse it
    const intruder = `harness-appload-${RUN}-intruder`;

    await db.insert(user).values({
        id: intruder,
        name: `${TAG} intruder`,
        email: `harness-appload-${RUN}-intruder@appload.invalid`,
        emailVerified: true,
        type: "shipper",
        status: "active",
    });
    madeUsers.push(intruder);

    const membershipId = crypto.randomUUID();

    await db.insert(member).values({
        id: membershipId,
        organizationId: APPLOAD_ORG_ID,
        userId: intruder,
        role: "member",
        createdAt: new Date(),
    });
    madeMembers.push(membershipId);

    await expectError("a member of Appload is no portal tenant", () =>
        as(intruder).me.railCounts(), "NOT_PARTNER_ACCOUNT");

    const found = await as(cast.shipper.user).partners.search({ query: APPLOAD_ORG_NAME, relation: "client-carrier" });

    check("the partner search never offers Appload as a company to connect to",
        !found.some((candidate) => candidate.id === APPLOAD_ORG_ID), found.map((candidate) => candidate.name));

    const options = await as(cast.shipper.user).movements.formOptions();

    check("the load form pins Appload in front of the company's own partners",
        options.partners[0]?.id === APPLOAD_ORG_ID && options.partners[0]?.type === "appload",
        options.partners.map((partner) => [partner.id, partner.type]));
    check("…exactly once, and always on the portal",
        options.partners.filter((partner) => partner.id === APPLOAD_ORG_ID).length === 1
        && options.partners[0]?.onPortal === true, options.partners[0]);
}

/** §8 — a load handed to Appload becomes an order, and the company keeps its row. */
async function handOver() {
    const s = as(cast.shipper.user);

    console.log("\n— the client hands a load to Appload");

    const filed = await s.movements.create({
        execution: "partner",
        carrierOrgId: APPLOAD_ORG_ID,
        origin: loading,
        destination: offloading,
        route: "national",
        category: "general-cargo",
        cargoDescription: `${TAG} milho, 30t`,
        weight: 30,
        weightUnit: "ton",
        expectedLoadingDate: new Date(Date.now() + 86_400_000),
    });
    main.load = filed.id;

    const before = await loadRow(filed.id);

    check("a load filed with Appload is a request, numbered in the client's own books",
        filed.ref === `REQ-0001-${YY}`, filed.ref);
    check("…and carries no order number yet", before.reference === null && before.requestReference === filed.ref, before);

    const offered = await s.movements.offer({ id: filed.id, expectedVersion: before.version });
    const brokered = await orderBehind(filed.id);

    main.orderPk = brokered.id;
    main.orderId = brokered.orderId;

    check("sending it opens an Appload order for it", brokered.status === "prospect", brokered.status);
    check("…filed for the company that handed it over",
        brokered.shipperId === cast.shipper.org && brokered.shipperName === cast.shipper.name, {
            shipperId: brokered.shipperId, name: brokered.shipperName,
        });
    check("…and recorded as having come from a client", brokered.source === "client", brokered.source);

    const row = await loadRow(filed.id);

    check("the client's own row is on the order, offered", row.status === "offered" && row.orderId === brokered.id, row);
    check("…and there is exactly ONE row on it for this company",
        (await rowsOf(brokered.id, cast.shipper.org)).length === 1,
        (await rowsOf(brokered.id, cast.shipper.org)).map((entry) => [entry.id, entry.status]));

    const detail = await s.movements.get({ id: filed.id });

    check("the load page reads as the orderer's side of the APPL order",
        detail.appload?.orderId === brokered.orderId && detail.appload.role === "orderer", detail.appload);

    const listed = await s.movements.list({ scope: "orders", section: "procurement", pageSize: 100 });
    const mine = listed.items.find((item) => item.id === filed.id);

    check("it sits under Orders › Procurement with Appload as the partner",
        mine?.carrier?.name === APPLOAD_ORG_NAME, { found: Boolean(mine), carrier: mine?.carrier });
    check("…showing its own reference and the Appload id beside it",
        mine?.ref === `REQ-0001-${YY}` && mine.apploadOrderId === brokered.orderId, {
            ref: mine?.ref, appload: mine?.apploadOrderId,
        });

    await expectError("the load itself can no longer be moved by hand", () =>
        s.movements.transition({ id: filed.id, to: "booked", expectedVersion: offered.version }),
        "FOLLOWS_APPLOAD_ORDER");

    await expectError("a stranger reads neither the load…", () =>
        as(cast.stranger.user).movements.get({ id: filed.id }), "NOT_FOUND");
    await expectError("…nor the order behind it", () =>
        as(cast.stranger.user).orders.get({ orderId: brokered.orderId }), "NOT_FOUND");

    console.log("\n— …and one Appload cannot be told what to move");

    const vague = await s.movements.create({
        execution: "partner",
        carrierOrgId: APPLOAD_ORG_ID,
        origin: loading,
        destination: offloading,
        route: "national",
        category: "general-cargo",
        cargoDescription: `${TAG} sem data`,
        weight: 12,
        weightUnit: "ton",
    });
    const vagueRow = await loadRow(vague.id);

    await expectError("a load with no loading date is refused, not guessed at", () =>
        s.movements.offer({ id: vague.id, expectedVersion: vagueRow.version }),
        "APPLOAD_NEEDS_DETAILS");
}

/** §8 — the request round: candidates, a quote, a withdrawal and the booking. */
async function theRound() {
    const s = as(cast.shipper.user);
    const c = as(cast.carrier.user);

    console.log("\n— Appload sends the load out to two carriers");

    const sent = await s.orders.sendRequests({
        orderId: main.orderId,
        carrierOrgIds: [cast.carrier.org, cast.other.org],
    });

    check("both carriers were asked", sent.sent === 2, sent);

    const candidate = await rowOf(main.orderPk, cast.carrier.org);
    const rival = await rowOf(main.orderPk, cast.other.org);

    check("each of them gets a load of its own, on its own trucks",
        candidate?.execution === "own-fleet" && rival?.execution === "own-fleet",
        { candidate: candidate?.execution, rival: rival?.execution });
    check("…offered, with Appload as the client and the APPL id as its reference",
        candidate?.status === "offered"
        && candidate.clientOrgId === APPLOAD_ORG_ID
        && candidate.clientName === APPLOAD_ORG_NAME
        && candidate.clientReference === main.orderId, candidate);
    check("…and no number of its own until somebody commits", candidate?.reference === null, candidate?.reference);

    const trips = await c.movements.list({ scope: "trips", section: "procurement", pageSize: 100 });
    const listed = trips.items.find((item) => item.id === candidate!.id);

    check("the carrier finds it in My trucks › Procurement", Boolean(listed), trips.items.map((item) => item.ref));
    check("…named by the Appload id, since it has nothing else yet",
        listed?.ref === main.orderId && listed.apploadOrderId === main.orderId, { ref: listed?.ref });

    const rail = await c.me.railCounts();

    check("…and the rail counts it as work received", rail.received === 1, rail);

    const detail = await c.movements.get({ id: candidate!.id });

    check("the load page reads as one of the carriers still being asked",
        detail.appload?.role === "candidate" && detail.appload.orderId === main.orderId, detail.appload);

    console.log("\n— one quotes, the other is taken off");

    const quote = await c.orders.offers.create({
        orderId: main.orderId,
        values: { fiscalRegime: "normal", total: 50_000, currency: "MZN" },
    });

    check("the carrier's row moves with its answer",
        (await loadRow(candidate!.id)).status === "prospect", (await loadRow(candidate!.id)).status);

    await s.orders.withdrawRequest({ orderId: main.orderId, carrierOrgId: cast.other.org });

    check("the carrier that was taken off the round loses its row",
        (await loadRow(rival!.id)).status === "cancelled", (await loadRow(rival!.id)).status);
    check("…and nothing of the round leaked onto it", (await loadRow(rival!.id)).reference === null);

    console.log("\n— the client books the quote it was given");

    const placed = await s.orders.get({ orderId: main.orderId });
    await s.orders.offers.accept({ orderId: main.orderId, offerId: quote.id, expectedVersion: placed.version });

    const booked = await orderRow(main.orderId);
    const ordererRow = await rowOf(main.orderPk, cast.shipper.org);
    const executorRow = await rowOf(main.orderPk, cast.carrier.org);

    main.carrierRow = executorRow!.id;

    check("the order is booked", booked.status === "booked" && booked.carrierId === cast.carrier.org, booked.status);
    check("the client's row is booked and takes its own order number",
        ordererRow?.status === "booked" && ordererRow.reference === `ORD-0001-${YY}`, ordererRow);
    check("…keeping the request it was filed under as history",
        ordererRow?.requestReference === `REQ-0001-${YY}`, ordererRow?.requestReference);
    check("…and what it owes Appload as its buy leg",
        Number(ordererRow?.buyTotal) === Number(booked.shipperTotal), {
            buy: ordererRow?.buyTotal, shipper: booked.shipperTotal,
        });

    check("the carrier's row is booked with ITS OWN first order number",
        executorRow?.status === "booked" && executorRow.reference === `ORD-0001-${YY}`, executorRow);
    check("…carrying what Appload calls the load as the client's reference",
        executorRow?.clientReference === main.orderId, executorRow?.clientReference);
    check("…and what Appload pays it as its sell leg",
        Number(executorRow?.sellTotal) === Number(booked.carrierTotal), {
            sell: executorRow?.sellTotal, carrier: booked.carrierTotal,
        });

    console.log("\n— what each company may still write on its own row");

    await expectError("the terms of the load are the order's, not the carrier's", () =>
        c.movements.update({
            id: executorRow!.id,
            expectedVersion: executorRow!.version,
            route: "regional",
            expectedDeliveryAt: new Date(Date.now() + 8 * 86_400_000),
        }), "FIELD_LOCKED");

    const cost = await c.movements.costs.add({
        movementId: executorRow!.id,
        kind: "fuel",
        amount: 1200,
        currency: "MZN",
        description: `${TAG} diesel`,
    });

    check("…while what the trip costs it stays its own business", Boolean(cost.id), cost);

    const paid = await s.movements.recordPayment({
        id: ordererRow!.id,
        expectedVersion: ordererRow!.version,
        leg: "buy",
        amount: 1,
        reference: `${TAG} adiantamento`,
    });

    check("…and so does what it has paid against its own leg", Boolean(paid.id), paid);
}

/** §8 — the booking taken back, and the carrier booked again with a fresh number. */
async function unbookAndRebook() {
    const s = as(cast.shipper.user);
    const c = as(cast.carrier.user);

    console.log("\n— Appload takes the booking back");

    const current = await orderRow(main.orderId);

    await applyTransition(staff(cast.manager, "manager"), {
        orderId: main.orderId,
        to: "prospect",
        expectedVersion: current.version,
        note: `${TAG} carrier released, back out to the market`,
    });

    const orderer = await rowOf(main.orderPk, cast.shipper.org);
    const released = await loadRow(main.carrierRow);

    check("the client's row waits again", orderer?.status === "offered", orderer?.status);
    check("…keeping the number it was given", orderer?.reference === `ORD-0001-${YY}`, orderer?.reference);
    check("the carrier that was released loses its row", released.status === "cancelled", released.status);

    console.log("\n— …and books the same carrier again");

    await s.orders.sendRequests({ orderId: main.orderId, carrierOrgIds: [cast.carrier.org] });

    const fresh = await rowOf(main.orderPk, cast.carrier.org);

    check("the carrier is asked again, on a row of its own", fresh !== null && fresh.id !== released.id, {
        was: released.id, now: fresh?.id,
    });

    const requote = await c.orders.offers.create({
        orderId: main.orderId,
        values: { fiscalRegime: "normal", total: 52_000, currency: "MZN" },
    });
    const prospect = await s.orders.get({ orderId: main.orderId });

    await s.orders.offers.accept({ orderId: main.orderId, offerId: requote.id, expectedVersion: prospect.version });

    const rebooked = await rowOf(main.orderPk, cast.carrier.org);
    main.carrierRow = rebooked!.id;

    check("the new row is booked with the carrier's NEXT order number",
        rebooked?.status === "booked" && rebooked.reference === `ORD-0002-${YY}`, rebooked);
    check("…and the old one stayed cancelled", (await loadRow(released.id)).status === "cancelled");
}

/** §8 — the dispatch, and what it leaves on the two rows. */
async function dispatch(rig: { driverId: string; driverPhone: string; truckId: string; plate: string }) {
    const c = as(cast.carrier.user);

    console.log("\n— the carrier files its rig's papers and Appload sends the truck");

    const licence = await c.kyc.upload({
        subjectType: "driver",
        subjectId: rig.driverId,
        type: "driver-license",
        pages: [{ url: kycPageUrl("driver", rig.driverId, "driver-license", "jpg"), mimeType: "image/jpeg" }],
        expiresAt: "2099-01-31",
    });
    madeKycDocs.push(licence.document.id);

    const booklet = await c.kyc.upload({
        subjectType: "truck",
        subjectId: rig.truckId,
        type: "vehicle-booklet",
        pages: [{ url: kycPageUrl("truck", rig.truckId, "vehicle-booklet", "pdf"), mimeType: "application/pdf" }],
    });
    madeKycDocs.push(booklet.document.id);

    check("the papers are on file, waiting for a reviewer",
        licence.document.status === "pending" && booklet.document.status === "pending");

    // What Admin's deal form writes before it moves the order: the rig on the
    // order row, under its own optimistic lock. The gate, the pack and the
    // mirror below are all the shared door's own work
    const before = await orderRow(main.orderId);

    const [staged] = await db
        .update(order)
        .set({
            driverId: rig.driverId,
            driverName: `${TAG} Motorista`,
            driverPhoneNumber: rig.driverPhone,
            truckPlate: rig.plate,
            truckAge: "recent",
            version: sql`${order.version} + 1`,
        })
        .where(and(eq(order.id, main.orderPk), eq(order.version, before.version)))
        .returning({ version: order.version });

    const moved = await applyTransition(staff(cast.ops, "user"), {
        orderId: main.orderId,
        to: "at-loading",
        expectedVersion: staged!.version,
    });

    check("the order leaves for the loading site", moved.order.status === "at-loading", moved.order.status);
    check("…and the move wrote the pack it left with", Boolean(moved.dispatchId), moved.dispatchId);

    const orderer = await rowOf(main.orderPk, cast.shipper.org);
    const executor = await loadRow(main.carrierRow);

    check("both companies' rows are at the loading site",
        orderer?.status === "at-loading" && executor.status === "at-loading",
        { orderer: orderer?.status, executor: executor.status });
    check("…each stamped with when the load started",
        orderer?.startedAt !== null && executor.startedAt !== null,
        { orderer: orderer?.startedAt, executor: executor.startedAt });
    check("the row of the company moving it carries the driver and the plate",
        executor.driverName === `${TAG} Motorista` && executor.truckPlate === rig.plate, executor);
    check("…and the client's row does not — the rig is not its business",
        orderer?.driverName === null && orderer.truckPlate === null, orderer);

    const usage = await db
        .select({ entityType: subscriptionUsage.entityType, entityId: subscriptionUsage.entityId })
        .from(subscriptionUsage)
        .where(inArray(subscriptionUsage.organizationId, [cast.shipper.org, cast.carrier.org]));

    check("the trip is billed as an order, once per company, and never as a load too",
        usage.length > 0
        && usage.every((row) => row.entityType === "order" && row.entityId === main.orderPk), usage);

    console.log("\n— the map: one truck, drawn once");

    const pins = await as(cast.shipper.user).map.overview();
    const forThisLoad = pins.filter((pin) => pin.id === main.load || pin.id === main.orderId);

    check("the client sees the load once, as its own row rather than as the order",
        forThisLoad.length === 1 && forThisLoad[0]?.kind === "load" && forThisLoad[0].id === main.load,
        forThisLoad.map((pin) => [pin.kind, pin.id, pin.ref]));

    // Everything the dispatch had to prove is proved. The number this run
    // invented for its driver comes off the order before the trip reaches a
    // tracked status: Admin's tracking cron runs live against this database
    // and would otherwise send a real WhatsApp to a number nobody here owns.
    // The rows keep the driver they were given — which is what the mirror
    // wrote and what the checks below read.
    await db.update(order).set({ driverPhoneNumber: null }).where(eq(order.id, main.orderPk));
}

/** §8 — the tracking the order side owns, and the delivery the rows follow. */
async function deliverAndClose(rig: { driverPhone: string }) {
    const s = as(cast.shipper.user);
    const c = as(cast.carrier.user);

    console.log("\n— the truck on the road: asked by the order, never by the rows");

    await walk(staff(cast.ops, "user"), main.orderId, ["loading", "on-route"]);

    const orderer = await rowOf(main.orderPk, cast.shipper.org);
    const executor = await loadRow(main.carrierRow);

    check("both rows followed the truck onto the road",
        orderer?.status === "on-route" && executor.status === "on-route",
        { orderer: orderer?.status, executor: executor.status });
    // What the movement slot's own select refuses (tracking/movement-slot.ts
    // `isNull(movement.orderId)`): a row with an order behind it is asked by
    // the order runner, which is also what bills it
    check("neither row is one the movement tracking slot would ever ping",
        orderer?.orderId !== null && executor.orderId !== null,
        { orderer: orderer?.orderId, executor: executor.orderId });
    check("…and the row the order opened was opened with its tracking off",
        executor.trackingEnabled === false, executor.trackingEnabled);

    const pinned = await resolveMovementForConversation(db, {
        conversationId: `harness-${RUN}-no-thread`,
        driverPhone: normalizePhone(rig.driverPhone),
    });

    check("…and a position the driver shares is the order's pin, not a load's",
        pinned === null, pinned);

    console.log("\n— delivered, completed, and each company closing its own books");

    await walk(staff(cast.ops, "user"), main.orderId, ["at-offloading", "offloading", "delivered"]);

    check("both rows are delivered",
        (await rowOf(main.orderPk, cast.shipper.org))?.status === "delivered"
        && (await loadRow(main.carrierRow)).status === "delivered");

    const delivered = await orderRow(main.orderId);

    await applyTransition(staff(cast.manager, "manager"), {
        orderId: main.orderId,
        to: "completed",
        expectedVersion: delivered.version,
        document: {
            url: `https://files.edgestore.dev/bdf53w7xn42a844s/apploadFiles/_public/${main.orderId}/${crypto.randomUUID()}.pdf`,
            name: `${TAG} POD`,
            size: 1024,
            mimeType: "application/pdf",
        },
    });

    const afterCompletion = await rowOf(main.orderPk, cast.shipper.org);
    const executorAfter = await loadRow(main.carrierRow);

    check("Appload closing its own books leaves both rows delivered",
        afterCompletion?.status === "delivered" && executorAfter.status === "delivered",
        { orderer: afterCompletion?.status, executor: executorAfter.status });

    await expectError("…and a company cannot close an unsettled leg", () =>
        s.movements.transition({ id: afterCompletion!.id, to: "closed", expectedVersion: afterCompletion!.version }),
        "UNSETTLED");

    const owing = await rowOf(main.orderPk, cast.shipper.org);
    const settledOrderer = await s.movements.recordPayment({
        id: owing!.id,
        expectedVersion: owing!.version,
        leg: "buy",
        amount: Number(owing!.buyTotal) - 1,
        reference: `${TAG} saldo`,
    });
    const closedOrderer = await s.movements.transition({
        id: owing!.id,
        to: "closed",
        expectedVersion: settledOrderer.version,
    });

    check("once it has paid Appload, the client closes its own load",
        closedOrderer.status === "closed", closedOrderer.status);

    const receiving = await loadRow(main.carrierRow);
    const settledExecutor = await c.movements.recordPayment({
        id: receiving.id,
        expectedVersion: receiving.version,
        leg: "sell",
        amount: Number(receiving.sellTotal),
        reference: `${TAG} recebido`,
    });
    const closedExecutor = await c.movements.transition({
        id: receiving.id,
        to: "closed",
        expectedVersion: settledExecutor.version,
    });

    check("…and once Appload has paid it, so does the carrier",
        closedExecutor.status === "closed", closedExecutor.status);
}

/** §8 — what a cancelled order does to the rows, before and after anybody committed. */
async function cancels() {
    const s = as(cast.shipper.user);
    const c = as(cast.carrier.user);

    console.log("\n— a load called off while it was still a request");

    const early = await s.movements.create({
        execution: "partner",
        carrierOrgId: APPLOAD_ORG_ID,
        origin: loading,
        destination: offloading,
        route: "national",
        category: "general-cargo",
        cargoDescription: `${TAG} cancelada cedo`,
        weight: 8,
        weightUnit: "ton",
        expectedLoadingDate: new Date(Date.now() + 2 * 86_400_000),
    });

    let row = await loadRow(early.id);
    await s.movements.offer({ id: early.id, expectedVersion: row.version });

    const earlyOrder = await orderBehind(early.id);
    const placed = await s.orders.get({ orderId: earlyOrder.orderId });

    await s.orders.cancel({
        orderId: earlyOrder.orderId,
        expectedVersion: placed.version,
        note: `${TAG} client changed its mind`,
    });

    row = await loadRow(early.id);

    check("the client gets its load back rather than losing it",
        row.status === "declined" && row.orderId === null, row);
    check("…and may hand it somewhere else, under the number it was filed with",
        row.requestReference === early.ref && /^REQ-\d{4}-\d{2}$/.test(early.ref) && row.reference === null,
        { filed: early.ref, row: [row.requestReference, row.reference] });

    console.log("\n— …and one called off after a truck had been committed");

    const late = await s.movements.create({
        execution: "partner",
        carrierOrgId: APPLOAD_ORG_ID,
        origin: loading,
        destination: offloading,
        route: "national",
        category: "general-cargo",
        cargoDescription: `${TAG} cancelada tarde`,
        weight: 9,
        weightUnit: "ton",
        expectedLoadingDate: new Date(Date.now() + 3 * 86_400_000),
    });

    row = await loadRow(late.id);
    await s.movements.offer({ id: late.id, expectedVersion: row.version });

    const lateOrder = await orderBehind(late.id);

    await s.orders.sendRequests({ orderId: lateOrder.orderId, carrierOrgIds: [cast.carrier.org] });

    const quote = await c.orders.offers.create({
        orderId: lateOrder.orderId,
        values: { fiscalRegime: "normal", total: 33_000, currency: "MZN" },
    });
    const prospect = await s.orders.get({ orderId: lateOrder.orderId });

    await s.orders.offers.accept({ orderId: lateOrder.orderId, offerId: quote.id, expectedVersion: prospect.version });

    const carrierRow = await rowOf(lateOrder.id, cast.carrier.org);
    const booked = await s.orders.get({ orderId: lateOrder.orderId });

    await s.orders.cancel({
        orderId: lateOrder.orderId,
        expectedVersion: booked.version,
        note: `${TAG} cargo no longer available`,
    });

    check("both companies' rows are cancelled with the order",
        (await loadRow(late.id)).status === "cancelled"
        && (await loadRow(carrierRow!.id)).status === "cancelled",
        { orderer: (await loadRow(late.id)).status, executor: (await loadRow(carrierRow!.id)).status });
}

/** §8 — a transporter handing its OWN load to Appload is that order's client. */
async function carrierAsClient() {
    const c = as(cast.carrier.user);

    console.log("\n— a transporter hands one of its own loads to Appload");

    const filed = await c.movements.create({
        execution: "partner",
        carrierOrgId: APPLOAD_ORG_ID,
        origin: loading,
        destination: offloading,
        route: "national",
        category: "general-cargo",
        cargoDescription: `${TAG} subcontratada`,
        weight: 15,
        weightUnit: "ton",
        expectedLoadingDate: new Date(Date.now() + 4 * 86_400_000),
    });

    const row = await loadRow(filed.id);
    await c.movements.offer({ id: filed.id, expectedVersion: row.version });

    const brokered = await orderBehind(filed.id);

    check("the order is the transporter's, and says where it came from",
        brokered.shipperId === cast.carrier.org && brokered.source === "carrier",
        { shipperId: brokered.shipperId, source: brokered.source });

    const seen = await c.orders.get({ orderId: brokered.orderId });

    check("…and the transporter reads it as the client of that order",
        seen.orderId === brokered.orderId, seen.orderId);

    const cancelled = await c.orders.cancel({
        orderId: brokered.orderId,
        expectedVersion: seen.version,
        note: `${TAG} kept in-house after all`,
    });

    check("…so it may also call it off", cancelled.status === "cancelled", cancelled.status);
}

/** §8 — the counters behind every reference. */
async function references() {
    const s = as(cast.shipper.user);

    console.log("\n— the reference counters, per company and per year");

    const raced = await Promise.all(
        Array.from({ length: 20 }, () => nextReference(db, cast.shipper.org, "ORD", new Date("2097-06-15T12:00:00Z"))),
    );

    check("twenty members filing at once get twenty different numbers",
        new Set(raced).size === 20, { distinct: new Set(raced).size });

    const [first, second] = await Promise.all([
        nextReference(db, cast.shipper.org, "ORD", new Date("2099-06-15T12:00:00Z")),
        nextReference(db, cast.carrier.org, "ORD", new Date("2099-06-15T12:00:00Z")),
    ]);

    check("two companies each get their own 0001 in the same year",
        first === "ORD-0001-99" && second === "ORD-0001-99", { first, second });

    const found = await s.movements.list({
        scope: "orders",
        section: "all",
        search: "ORD-0001",
        pageSize: 100,
    });

    check("a load is found by the number without its year",
        found.items.some((item) => item.id === main.load), found.items.map((item) => item.ref));

    const byDisplayId = await linkedMovementId(db, { orderId: main.orderId, organizationId: cast.shipper.org });
    const byPrimaryKey = await linkedMovementId(db, { orderId: main.orderPk, organizationId: cast.shipper.org });

    check("an APPL id resolves to this company's own row, by either key",
        byDisplayId === main.load && byPrimaryKey === main.load, { byDisplayId, byPrimaryKey, expected: main.load });
}

/**
 * §7 — the admin sign-in rule. Loaded through a specifier TypeScript cannot
 * follow on purpose: the module is Admin's, and its message keys are typed
 * against Admin's catalog, which this app's typecheck has never heard of.
 * The translator it takes is a stub — the schema only calls it for the error
 * strings, which is not what is being checked here.
 */
async function signIn() {
    console.log("\n— §7 the staff username, and what it refuses");

    const specifier = "../../admin/src/backend/schemas/sign-in.ts";
    const adminSchemas = await import(`${specifier}`) as {
        SignInSchema: (t: never) => { safeParse: (value: unknown) => { success: boolean } };
    };

    const schema = adminSchemas.SignInSchema(((key: string) => key) as never);
    const parse = (username: string) => schema.safeParse({ username, password: "whatever" }).success;

    check("a bare staff username is accepted", parse("claire"));
    check("…an address typed in full is not", !parse("claire@x"));
    check("…and neither is one with a space in it", !parse("cla ire"));
}

/** §7b — a company files its own papers; only the contract stays Appload's. */
async function companyKyc() {
    const c = as(cast.carrier.user);
    const s = as(cast.shipper.user);

    console.log("\n— §7b the company's own papers, filed from the portal");

    const alvara = await c.kyc.upload({
        subjectType: "organization",
        subjectId: cast.carrier.org,
        type: "alvara",
        pages: [{ url: kycPageUrl("organization", cast.carrier.org, "alvara", "pdf"), mimeType: "application/pdf" }],
        expiresAt: "2099-06-30",
    });
    madeKycDocs.push(alvara.document.id);

    const [after] = await db
        .select({ kycStatus: organization.kycStatus })
        .from(organization)
        .where(eq(organization.id, cast.carrier.org));

    check("a company may file a paper of its own, and it lands waiting for review",
        alvara.document.status === "pending" && alvara.document.subjectType === "organization",
        alvara.document.status);
    check("…and the company's verification is recomputed from what it now holds",
        after?.kycStatus === alvara.kycStatus, { row: after?.kycStatus, returned: alvara.kycStatus });

    await expectError("the signed contract is the one paper only Appload files", () =>
        c.kyc.upload({
            subjectType: "organization",
            subjectId: cast.carrier.org,
            type: "signed-contract",
            pages: [{ url: kycPageUrl("organization", cast.carrier.org, "signed-contract", "pdf") }],
            expiresAt: "2099-12-31",
        }), "CONTRACT_APPLOAD_ONLY");

    await expectError("…and nobody files papers for another company", () =>
        s.kyc.upload({
            subjectType: "organization",
            subjectId: cast.carrier.org,
            type: "nuit",
            pages: [{ url: kycPageUrl("organization", cast.carrier.org, "nuit", "pdf") }],
        }), "NOT_FOUND");

    // Admin's own door, which is `loadSubject` + `uploadKycDocument` with no
    // tenancy in front of it: staff reach any subject and any type
    const contract = await uploadKycDocument(db, {
        subject: await loadSubject(db, "organization", cast.other.org),
        type: "signed-contract",
        pages: [{ url: kycPageUrl("organization", cast.other.org, "signed-contract", "pdf"), mimeType: "application/pdf" }],
        expiresAt: "2099-12-31",
        uploadedBy: cast.manager,
    });
    madeKycDocs.push(contract.document.id);

    check("Appload still files the contract on a company's behalf",
        contract.document.status === "pending" && contract.document.type === "signed-contract",
        contract.document.status);

    console.log("\n— …and the bucket the pages go through says the same thing");

    const beforeUpload = edgeStoreRouter.buckets.kycFiles._def.beforeUpload!;
    const fileInfo = {
        size: 2048,
        type: "application/pdf",
        fileName: "paper.pdf",
        extension: "pdf",
        replaceTargetUrl: undefined,
        temporary: false,
    };
    const asMember = (subjectId: string, docType: string) => beforeUpload({
        ctx: { userId: cast.carrier.user, orgId: cast.carrier.org, isStaff: "false" },
        input: { subjectType: "organization", subjectId, docType },
        fileInfo,
    } as never);

    check("a member may upload its own company's alvara",
        await asMember(cast.carrier.org, "alvara") === true);
    check("…but never its signed contract",
        await asMember(cast.carrier.org, "signed-contract") === false);
    check("…and never anything under another company's prefix",
        await asMember(cast.other.org, "alvara") === false);
}

async function main_() {
    const rig = await world();

    await seedGuard();
    await handOver();
    await theRound();
    await unbookAndRebook();
    await dispatch(rig);
    await deliverAndClose(rig);
    await cancels();
    await carrierAsClient();
    await references();
    await signIn();
    await companyKyc();
}

// ---------------------------------------------------------------------------
// Cleanup: counted first, then taken away, then counted again
// ---------------------------------------------------------------------------

/** Every load row this run's companies hold — all of them are its own. */
async function ourMovements(): Promise<string[]> {
    if (madeOrgs.length === 0) return [];

    const rows = await db
        .select({ id: movement.id })
        .from(movement)
        .where(inArray(movement.organizationId, madeOrgs));

    return rows.map((row) => row.id);
}

/** How many rows of ours each table still holds. */
async function census(): Promise<Record<string, number>> {
    const loads = await ourMovements();

    const tally = async (
        label: string,
        ids: string[],
        run: (ids: string[]) => Promise<{ value: number }[]>,
    ) => [label, ids.length === 0 ? 0 : (await run(ids))[0]?.value ?? 0] as const;

    const entries = await Promise.all([
        tally("loads", loads, async (ids) => db.select({ value: count() }).from(movement).where(inArray(movement.id, ids))),
        tally("load-events", loads, async (ids) => db.select({ value: count() }).from(movementEvent).where(inArray(movementEvent.movementId, ids))),
        tally("load-costs", loads, async (ids) => db.select({ value: count() }).from(movementCost).where(inArray(movementCost.movementId, ids))),
        tally("counters", madeOrgs, async (ids) => db.select({ value: count() }).from(organizationCounter).where(inArray(organizationCounter.organizationId, ids))),
        tally("orders", madeOrders, async (ids) => db.select({ value: count() }).from(order).where(inArray(order.id, ids))),
        tally("offers", madeOrders, async (ids) => db.select({ value: count() }).from(orderOffer).where(inArray(orderOffer.orderId, ids))),
        tally("requests", madeOrders, async (ids) => db.select({ value: count() }).from(orderRequest).where(inArray(orderRequest.orderId, ids))),
        tally("history", madeOrders, async (ids) => db.select({ value: count() }).from(orderHistory).where(inArray(orderHistory.orderId, ids))),
        tally("order-documents", madeOrders, async (ids) => db.select({ value: count() }).from(orderDocument).where(inArray(orderDocument.orderId, ids))),
        tally("dispatch", madeOrders, async (ids) => db.select({ value: count() }).from(orderDispatch).where(inArray(orderDispatch.orderId, ids))),
        tally("checks", madeOrders, async (ids) => db.select({ value: count() }).from(orderLoadingCheck).where(inArray(orderLoadingCheck.orderId, ids))),
        tally("sheet-sync", madeOrders, async (ids) => db.select({ value: count() }).from(sheetSync).where(inArray(sheetSync.orderId, ids))),
        tally("usage", madeOrgs, async (ids) => db.select({ value: count() }).from(subscriptionUsage).where(inArray(subscriptionUsage.organizationId, ids))),
        tally("notifications", madeOrgs, async (ids) => db.select({ value: count() }).from(notification).where(inArray(notification.organizationId, ids))),
        tally("activity", [SESSION_ID], async () => db.select({ value: count() }).from(activityLog).where(eq(activityLog.sessionId, SESSION_ID))),
        tally("activity-by-actor", madeUsers, async (ids) => db.select({ value: count() }).from(activityLog).where(inArray(activityLog.actorId, ids))),
        tally("driver-threads", madeOrderIds, async (ids) => db.select({ value: count() }).from(chatConversation).where(inArray(chatConversation.orderId, ids))),
        // Written by Admin's own tracking cron, which runs live against this
        // database and may have reached one of these orders while it ran
        tally("tracking-requests", madeOrders, async (ids) => db.select({ value: count() }).from(trackingRequest).where(inArray(trackingRequest.orderId, ids))),
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

    const loads = await ourMovements();

    if (loads.length > 0) {
        await db.delete(notification).where(and(eq(notification.entityType, "movement"), inArray(notification.entityId, loads)));
        await db.delete(subscriptionUsage).where(and(eq(subscriptionUsage.entityType, "movement"), inArray(subscriptionUsage.entityId, loads)));
        await db.delete(movementDisputeRow).where(inArray(movementDisputeRow.movementId, loads));
        await db.delete(movementDispute).where(inArray(movementDispute.movementId, loads));
        for (const table of [movementEvent, movementCost, movementDocument, movementLocation, movementTrackingAlert, movementTrackingRequest, movementRoute]) {
            await db.delete(table).where(inArray(table.movementId, loads));
        }
        await db.update(movement).set({ executionMovementId: null }).where(inArray(movement.id, loads));
        await db.delete(movement).where(inArray(movement.id, loads));
    }

    if (madeOrderIds.length > 0) {
        // The thread's order link is a plain FK with no cascade, and the
        // tracking cron may have put a message on the thread it found
        const threads = await db
            .select({ id: chatConversation.id })
            .from(chatConversation)
            .where(inArray(chatConversation.orderId, madeOrderIds));

        if (threads.length > 0) {
            const ids = threads.map((thread) => thread.id);

            await db.delete(chatMessage).where(inArray(chatMessage.conversationId, ids));
            await db.delete(chatConversation).where(inArray(chatConversation.id, ids));
        }

        await db.delete(notification).where(and(eq(notification.entityType, "order"), inArray(notification.entityId, madeOrderIds)));
    }

    if (madeOrders.length > 0) {
        // Ditto: the cron's own row restricts the order's delete
        await db.delete(trackingRequest).where(inArray(trackingRequest.orderId, madeOrders));
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
    // Only this run's own counters: Appload's seed row has none and must keep
    // it that way, and every other company's are its own books
    if (madeOrgs.length > 0) await db.delete(organizationCounter).where(inArray(organizationCounter.organizationId, madeOrgs));
    // The membership on Appload's own row goes with the rest; the row itself
    // is the seed and is never touched
    if (madeMembers.length > 0) await db.delete(member).where(inArray(member.id, madeMembers));
    if (madeOrgs.length > 0) await db.delete(organization).where(inArray(organization.id, madeOrgs));
    // Sessions and accounts cascade off the account row
    if (madeUsers.length > 0) await db.delete(user).where(inArray(user.id, madeUsers));

    const left = await census();

    console.log("left behind:", JSON.stringify(left));
    check("every row the run wrote was taken away again", Object.keys(left).length === 0, left);

    const [seed] = await db.select({ id: organization.id }).from(organization).where(eq(organization.id, APPLOAD_ORG_ID));
    const [counters] = await db
        .select({ value: count() })
        .from(organizationCounter)
        .where(eq(organizationCounter.organizationId, APPLOAD_ORG_ID));

    check("…and Appload's own row, with no counters of its own, is still there",
        Boolean(seed) && counters?.value === 0, { seed: seed?.id, counters: counters?.value });
}

main_()
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
