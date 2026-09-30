/**
 * Seeds the SHARED DEV DATABASE with a demo world: one Appload order per
 * stage and per functionality (offers, booking, dispatch papers, loading
 * check, tracking pings on the map, interruptions, the border, delivery,
 * disputes, proofs of payment, completion, cancels, underbid, chat), and a
 * portal world beside it (own-fleet trips, partner orders offered / declined
 * / accepted / on the road / delivered and closed, costs, documents, a
 * dispute, an off-platform partner).
 *
 * Everything goes through the real doors — the portal routers as the two
 * test tenants, the shared order door as Appload staff — so every row is one
 * the app itself would have written. Only two things are written by hand:
 * the position pings (there is no driver on WhatsApp here) and the dates,
 * which are pushed back afterwards so the timelines read like weeks of work
 * rather than one minute of seeding.
 *
 * Tenants (Claire's, see the portal-test-accounts note): the shipper
 * "Cliente Teste Portal" and the carrier "A.S.M. Transportes" with its driver
 * "Motorista Teste" and truck AAA 123 MC. The carrier is given a full,
 * approved paper set so its dispatches are clean; one order is deliberately
 * booked with a logbook carrier that has none, to show the KYC flag.
 *
 * Every id it writes lands in seed-demo.manifest.json next to this file, and
 * `--reset` takes all of it away again (the carrier's papers included).
 *
 * Run from apps/app (the react-server condition turns `server-only` into the
 * no-op it is inside a server render; tsx is not a dependency):
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/seed-demo.ts          # what would be seeded
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/seed-demo.ts --yes    # seed
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/seed-demo.ts --reset  # remove the last seed
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { activityLog } from "@workspace/db/activity-log";
import { chatConversation, trackingRequest } from "@workspace/db/chats";
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
    type MovementStatus,
} from "@workspace/db/movements";
import { notification } from "@workspace/db/notifications";
import {
    order,
    orderDispatch,
    orderDispute,
    orderDocument,
    orderHistory,
    orderLoadingCheck,
    orderOffer,
    sheetSync,
    type Location,
} from "@workspace/db/orders";
import { contract, contractAllocation } from "@workspace/db/contracts";
import { subscriptionUsage } from "@workspace/db/subscriptions";
import { thread, threadMessage, threadParticipant, threadRead } from "@workspace/db/threads";
import { orderLocation, orderRoute } from "@workspace/db/tracking";
import type { KycDocumentType, OrderStatus } from "@workspace/db/types";
import { organization } from "@workspace/db/users";

import { auth } from "@workspace/auth/server";

import { currentDocuments, loadSubject, toCurrentDoc, writeDerivedStatus } from "@workspace/domain/kyc/subjects";
import type { Actor } from "@workspace/domain/orders/actor";
import { carrierSnapshot } from "@workspace/domain/orders/carrier-snapshot";
import { offerPricingColumns, priceOffer } from "@workspace/domain/orders/commission";
import { createOrder } from "@workspace/domain/orders/create";
import { portalNextOrderId } from "@workspace/domain/orders/next-order-id";
import { paymentSums } from "@workspace/domain/orders/payment-sums";
import { proofPaymentPatch } from "@workspace/domain/orders/payments";
import { CreateOrderSchemaServer } from "@workspace/domain/orders/schemas";
import { applyTransition } from "@workspace/domain/orders/transition";
import { sendMessage } from "@workspace/domain/threads/send";

import { getStaffGates } from "@workspace/trpc/staff-gate";
import { getTenantGates } from "@workspace/trpc/tenant-gate";
import { createCallerFactory } from "@workspace/trpc/init";

import { appRouter } from "@/backend/api/routers/_app";

import { computeOrderRoute } from "@workspace/maps/server/routes";

process.env.DATABASE_URL ??= fs.readFileSync(".env", "utf8").match(/^DATABASE_URL=(.+)$/m)![1]!.trim();
process.env.GOOGLE_MAPS_API_KEY ??= fs.readFileSync("../admin/.env", "utf8").match(/^GOOGLE_MAPS_API_KEY=(.+)$/m)?.[1]?.trim();

const WRITE = process.argv.includes("--yes");
const RESET = process.argv.includes("--reset");
/** Adds more trucks on the road to a seed that is already there, so the map has something to show */
const MORE = process.argv.includes("--more-on-route");
/** Puts alerts on trucks the seed already has on the road: off its route, and silent */
const ALERTS = process.argv.includes("--alerts");

const MANIFEST = fileURLToPath(new URL("./seed-demo.manifest.json", import.meta.url));

// ---------------------------------------------------------------------------
// The cast — existing rows on appload-dev, nothing here is created
// ---------------------------------------------------------------------------

/** The shipper tenant: delivered+portal-shipper@resend.dev */
const CTP = { user: "FT7QysKKfs5NKuut5i2S8Nhg6ItrwyuR", org: "42655a3f-0bd5-4e46-af29-9c5ee342a8aa" };
/** The carrier tenant: delivered+portal-carrier@resend.dev (owner) and its colleague (member) */
const ASM = { user: "a2R9UNA2NTiEo3FS7DxlwgBFUn8EDNU6", org: "9b7674e5-ea7b-416b-a199-6ca6842da718" };
const ASM_MEMBER = "AM6u6fxppa9LEkRiMnMDHyrMpThmNrQy";
/** The carrier's registered rig */
const RIG = { driverId: "7b8c3f9d-858d-4f61-91f6-6acf3ac926ca", truckId: "904b7a69-6e39-40d6-86d2-60aab85377c3", plate: "AAA 124 MC" };
/** The test driver's number, already on the carrier's own loads — nothing new is pinged */
const DRIVER_PHONE = "+258841112233";

/** Appload staff: Claire (admin) runs the desk, Raufa (manager) signs the risky moves */
const OPS = "PSDV7hFkEfqKPcY8frQ8XKZj0bKH2eSc";
const MANAGER = "BPwJV1fWTy1POgXrvnWXjKZlLzs2fzhj";

/** Logbook parties with no portal account: shown from the admin only */
const ETC_ADUBOS = "00d4e50a-7025-492e-aaac-18bd4a30a55e";
const LALGY = "1d8ff7ad-f705-452b-b232-b7149e452065";
const FFS = "01ed40af-519a-4b01-af20-d252e28adbc8";
const UNITRANS = "111c0e67-7df2-4631-9044-871b469e0211";

const SESSION_ID = `seed-demo-${Date.now().toString(36)}`;

const createCaller = createCallerFactory(appRouter);
const logged: Promise<unknown>[] = [];

const as = (userId: string) =>
    createCaller({
        authApi: auth.api,
        session: { user: { id: userId, name: "seed-demo" }, session: { id: SESSION_ID, userId } } as never,
        db,
        app: "portal",
        headers: new Headers(),
        waitUntil: (promise: Promise<unknown>) => logged.push(promise),
        staffGates: (id: string) => getStaffGates(db, { userId: id }),
        tenantGates: (id: string) => getTenantGates(db, { userId: id }),
    });

const staff = (userId: string, role: "admin" | "manager" | "user") => ({
    db,
    actor: { kind: "staff", userId, role } as Actor,
    sheets: "defer" as const,
});

const ops = staff(OPS, "admin");
const manager = staff(MANAGER, "manager");
const opsActor: Actor = { kind: "staff", userId: OPS, role: "admin" };
const tenantActor = (t: { user: string; org: string }, orgType: "shipper" | "carrier"): Actor =>
    ({ kind: "tenant", userId: t.user, organizationId: t.org, orgType });

// ---------------------------------------------------------------------------
// Places and lanes (real place ids off the logbook; the road polylines are
// read from the route cache the map already built for those pairs)
// ---------------------------------------------------------------------------

const P = {
    maputo: { address: "Maputo, Mozambique", placeId: "ChIJVdpmtiOX5h4RQrRrmld_SUI", country: "Mozambique", state: "Maputo" },
    matola: { address: "Matola, Mozambique", placeId: "ChIJHTpG-OqF5h4RPMgtvLMqoDE", country: "Mozambique", state: "Maputo Province" },
    beira: { address: "Beira, Mozambique", placeId: "ChIJwUegXV9qKh8R5razUC7d06E", country: "Mozambique", state: "Sofala Province" },
    chimoio: { address: "Chimoio, Mozambique", placeId: "ChIJKZkgp6A1KxkRivS8_1jfx60", country: "Mozambique", state: "Manica Province" },
    nacala: { address: "Nacala, Mozambique", placeId: "ChIJ9e5eYZOruRgR2akVwWFdd2I", country: "Mozambique", state: "Nampula Province" },
    nampula: { address: "Nampula, Mozambique", placeId: "ChIJOaE2a7M1xhgRdN3KTEt2F8I", country: "Mozambique", state: "Nampula Province" },
    pemba: { address: "Pemba, Mozambique", placeId: "ChIJER8ougDJvxgRtwcMyYN_Ip0", country: "Mozambique", state: "Cabo Delgado Province" },
    xaixai: { address: "Xai-Xai, Mozambique", placeId: "ChIJE99mKob74B4RWgTXV5_5y5I", country: "Mozambique", state: "Gaza Province" },
    tete: { address: "Tete, Mozambique", placeId: "ChIJubCl_4hHJhkRgiIROY03S3U", country: "Mozambique", state: "Tete Province" },
    joburg: { address: "Johannesburg, South Africa", placeId: "ChIJUWpA8GgMlR4RQUDTsdnJiiM", country: "South Africa", state: "Gauteng" },
} satisfies Record<string, Location>;

type Lane = { from: Location; to: Location; km: number; route: "national" | "regional" };

const L = {
    mapChi: { from: P.maputo, to: P.chimoio, km: 1167, route: "national" },
    nacBei: { from: P.nacala, to: P.beira, km: 1148, route: "national" },
    beiMap: { from: P.beira, to: P.maputo, km: 1174, route: "national" },
    chiMap: { from: P.chimoio, to: P.maputo, km: 1167, route: "national" },
    chiXai: { from: P.chimoio, to: P.xaixai, km: 953, route: "national" },
    mapPem: { from: P.maputo, to: P.pemba, km: 2460, route: "national" },
    matNam: { from: P.matola, to: P.nampula, km: 2054, route: "national" },
    mapTet: { from: P.maputo, to: P.tete, km: 1547, route: "national" },
    jhbChi: { from: P.joburg, to: P.chimoio, km: 1219, route: "regional" },
    jhbMap: { from: P.joburg, to: P.maputo, km: 551, route: "regional" },
} satisfies Record<string, Lane>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY);

/** A file URL shaped like our bucket's — nothing is uploaded, the link is decoration. */
const fileUrl = (name: string) => `https://files.edgestore.dev/bdf53w7xn42a844s/apploadFiles/_public/demo/${crypto.randomUUID()}/${name}`;
const kycUrl = (subjectType: string, subjectId: string, type: string, ext: string) =>
    `https://files.edgestore.dev/bdf53w7xn42a844s/kycFiles/_public/${subjectType}/${subjectId}/${type}/${crypto.randomUUID()}.${ext}`;

// ---------------------------------------------------------------------------
// The manifest: what a run wrote, so --reset can take it away
// ---------------------------------------------------------------------------

type Manifest = {
    sessionId: string;
    orders: string[];
    orderIds: string[];
    movements: string[];
    kycDocs: string[];
    /** Absent on manifests from before the contracts module */
    contracts?: string[];
};

const made: Manifest = { sessionId: SESSION_ID, orders: [], orderIds: [], movements: [], kycDocs: [], contracts: [] };

function saveManifest() {
    fs.writeFileSync(MANIFEST, JSON.stringify(made, null, 2));
}

// ---------------------------------------------------------------------------
// Roads: the cached polyline of a lane, decoded, so pings sit on the road
// ---------------------------------------------------------------------------

function decodePolyline(encoded: string): [number, number][] {
    const points: [number, number][] = [];
    let index = 0, lat = 0, lng = 0;

    while (index < encoded.length) {
        for (const axis of ["lat", "lng"] as const) {
            let shift = 0, result = 0, byte: number;
            do {
                byte = encoded.charCodeAt(index++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
            } while (byte >= 0x20);
            const delta = result & 1 ? ~(result >> 1) : result >> 1;
            if (axis === "lat") lat += delta; else lng += delta;
        }
        points.push([lat / 1e5, lng / 1e5]);
    }

    return points;
}

type CachedRoute = typeof orderRoute.$inferSelect;

async function cachedRoute(lane: Lane): Promise<CachedRoute | null> {
    const [row] = await db
        .select()
        .from(orderRoute)
        .where(and(
            eq(orderRoute.originPlaceId, lane.from.placeId),
            eq(orderRoute.destinationPlaceId, lane.to.placeId),
            eq(orderRoute.source, "routes"),
        ))
        .limit(1);

    if (row) return row;

    // Nothing cached for this pair on this database: ask Google once per lane
    // and remember it, so every order and load on the lane draws the same road
    if (!computed.has(lane)) {
        const road = await computeOrderRoute(lane.from, lane.to);
        computed.set(lane, road && {
            orderId: "",
            originPlaceId: lane.from.placeId,
            destinationPlaceId: lane.to.placeId,
            originLat: road.origin.lat,
            originLng: road.origin.lng,
            destinationLat: road.destination.lat,
            destinationLng: road.destination.lng,
            encodedPolyline: road.encodedPolyline,
            distanceMeters: road.distanceMeters,
            durationSeconds: road.durationSeconds,
            source: road.source,
            computedAt: new Date(),
        });
    }

    return computed.get(lane) ?? null;
}

const computed = new Map<Lane, CachedRoute | null>();

/** Points along the lane at the given fractions of the road, or of the chord when no road is cached. */
async function along(lane: Lane, fractions: number[]): Promise<[number, number][]> {
    const cached = await cachedRoute(lane);
    const road = cached?.encodedPolyline ? decodePolyline(cached.encodedPolyline) : null;

    if (road && road.length > 1) {
        return fractions.map((f) => road[Math.min(road.length - 1, Math.round(f * (road.length - 1)))]!);
    }

    // No road cached for this pair: the chord between two cached endpoints of
    // the same places, or nothing to draw at all
    const [origin] = await db.select().from(orderRoute).where(eq(orderRoute.originPlaceId, lane.from.placeId)).limit(1);
    const [dest] = await db.select().from(orderRoute).where(eq(orderRoute.destinationPlaceId, lane.to.placeId)).limit(1);

    if (!origin || !dest) return [];

    return fractions.map((f) => [
        origin.originLat + (dest.destinationLat - origin.originLat) * f,
        origin.originLng + (dest.destinationLng - origin.originLng) * f,
    ]);
}

/** Copies the lane's cached road onto the order, so the map draws it without asking Google. */
async function copyOrderRoute(orderPk: string, lane: Lane) {
    const cached = await cachedRoute(lane);
    if (!cached) return;
    await db.insert(orderRoute).values({ ...cached, orderId: orderPk, computedAt: new Date() }).onConflictDoNothing();
}

async function copyMovementRoute(movementId: string, lane: Lane) {
    const cached = await cachedRoute(lane);
    if (!cached) return;
    const { orderId: _orderId, ...road } = cached;
    await db.insert(movementRoute).values({ ...road, movementId, computedAt: new Date() }).onConflictDoNothing();
}

/** Position pings along the lane up to `progress`, the last one `endHoursAgo` back, one every `stepHours`. */
async function pingOrder(orderPk: string, lane: Lane, progress: number, count = 5, endHoursAgo = 1, stepHours = 6) {
    const fractions = Array.from({ length: count }, (_, i) => (progress * (i + 1)) / count);
    const points = await along(lane, fractions);

    if (points.length === 0) return;

    await db.insert(orderLocation).values(points.map(([latitude, longitude], i) => ({
        orderId: orderPk,
        latitude,
        longitude,
        source: "manual" as const,
        recordedAt: new Date(Date.now() - (endHoursAgo + (points.length - 1 - i) * stepHours) * HOUR),
    })));
}

async function pingMovement(movementId: string, lane: Lane, progress: number, count = 5, endHoursAgo = 1, stepHours = 6) {
    const fractions = Array.from({ length: count }, (_, i) => (progress * (i + 1)) / count);
    const points = await along(lane, fractions);

    if (points.length === 0) return;

    await db.insert(movementLocation).values(points.map(([latitude, longitude], i) => ({
        movementId,
        latitude,
        longitude,
        source: "manual" as const,
        recordedAt: new Date(Date.now() - (endHoursAgo + (points.length - 1 - i) * stepHours) * HOUR),
    })));
}

// ---------------------------------------------------------------------------
// The carrier's papers: a verified company, driver and truck
// ---------------------------------------------------------------------------

const EXPIRES = "2027-12-31";

async function approvedPaper(subjectType: "organization" | "driver" | "truck", subjectId: string, type: KycDocumentType, expires: boolean) {
    const [existing] = await db
        .select({ id: kycDocument.id })
        .from(kycDocument)
        .where(and(
            eq(kycDocument.subjectType, subjectType),
            eq(kycDocument.subjectId, subjectId),
            eq(kycDocument.type, type),
            eq(kycDocument.status, "approved"),
            isNull(kycDocument.deletedAt),
        ))
        .limit(1);

    if (existing) return;

    const [row] = await db
        .insert(kycDocument)
        .values({
            subjectType,
            subjectId,
            type,
            pages: [{ url: kycUrl(subjectType, subjectId, type, "pdf"), mimeType: "application/pdf" }],
            status: "approved",
            expiresAt: expires ? EXPIRES : null,
            reviewedBy: MANAGER,
            reviewedAt: new Date(),
            uploadedBy: OPS,
        })
        .returning({ id: kycDocument.id });

    made.kycDocs.push(row!.id);
}

async function rederive(subjectType: "organization" | "driver" | "truck", subjectId: string) {
    const subject = await loadSubject(db, subjectType, subjectId);
    const docs = await currentDocuments(db, subject);
    return writeDerivedStatus(db, subject, docs.map(toCurrentDoc));
}

async function verifyCarrier() {
    console.log("\n— A.S.M. Transportes: papers on file, reviewed and approved");

    const company: [KycDocumentType, boolean][] = [
        ["nuit", false], ["id-card", true], ["commercial-certificate", false], ["alvara", true],
        ["bank-letter", false], ["republic-bulletin", false], ["commercial-exercise", false], ["signed-contract", true],
    ];

    for (const [type, expires] of company) await approvedPaper("organization", ASM.org, type, expires);
    await approvedPaper("driver", RIG.driverId, "driver-license", true);
    await approvedPaper("truck", RIG.truckId, "vehicle-booklet", false);
    await approvedPaper("truck", RIG.truckId, "proof-of-ownership", false);

    console.log("  company", await rederive("organization", ASM.org));
    console.log("  driver ", await rederive("driver", RIG.driverId));
    console.log("  truck  ", await rederive("truck", RIG.truckId));
}

// ---------------------------------------------------------------------------
// Appload orders
// ---------------------------------------------------------------------------

type Cargo = { category: (typeof CATEGORY)[number]; description: string; weight: number; packing?: string };

const CATEGORY = ["agriculture-inputs", "agriculture-products", "construction", "machinery-equipment", "fmcg", "general-cargo", "medicine", "mining", "oil-gas", "vehicles", "other"] as const;

async function orderRow(orderId: string) {
    const [row] = await db.select().from(order).where(eq(order.orderId, orderId));
    return row!;
}

function remember(row: { id: string; orderId: string }) {
    made.orders.push(row.id);
    made.orderIds.push(row.orderId);
    saveManifest();
}

/** The client files an order from the portal. */
async function clientOrder(lane: Lane, cargo: Cargo, loadingInDays: number): Promise<{ orderId: string; pk: string }> {
    const { orderId } = await as(CTP.user).orders.create({
        loadingAddress: lane.from,
        expectedLoadingDate: daysFromNow(loadingInDays),
        expectedOffloadingDate: daysFromNow(loadingInDays + Math.ceil(lane.km / 450)),
        offloadingAddress: lane.to,
        distance: lane.km,
        routeType: lane.route,
        category: cargo.category,
        description: cargo.description,
        weight: cargo.weight,
        weightUnit: "ton",
        loadType: "dedicated",
        ...(cargo.packing && { packing: cargo.packing as never }),
    });

    const row = await orderRow(orderId);
    remember(row);
    console.log(`  ${orderId}  ${cargo.description}`);

    return { orderId, pk: row.id };
}

type StaffOffer = { carrierId: string; total: number; commission: number; accepted?: boolean; notes?: string; git?: boolean; gps?: boolean };

/** Appload files an order for a logbook shipper, prospect or booked on the spot. */
async function staffOrder(
    shipperId: string,
    lane: Lane,
    cargo: Cargo,
    loadingInDays: number,
    offers: StaffOffer[] = [],
): Promise<{ orderId: string; pk: string }> {
    const names = await orgNames([shipperId, ...offers.map((o) => o.carrierId)]);
    const status = offers.some((o) => o.accepted) ? "booked" : "prospect";

    const payload = CreateOrderSchemaServer.parse({
        shipperId,
        shipperName: names.get(shipperId),
        status,
        loadingAddress: lane.from,
        expectedLoadingDate: daysFromNow(loadingInDays),
        expectedOffloadingDate: daysFromNow(loadingInDays + Math.ceil(lane.km / 450)),
        offloadingAddress: lane.to,
        distance: lane.km,
        deliveries: 1,
        routeType: lane.route,
        tripType: "normal",
        category: cargo.category,
        description: cargo.description,
        weight: cargo.weight,
        weightUnit: "ton",
        loadType: "dedicated",
        shipperCurrency: "MZN",
        offers: offers.map((o) => ({
            carrierId: o.carrierId,
            carrierName: names.get(o.carrierId),
            fiscalRegime: "normal",
            total: o.total,
            currency: "MZN",
            commissionTotal: o.commission,
            includesGit: o.git ?? false,
            includesGps: o.gps ?? false,
            notes: o.notes,
            accepted: o.accepted ?? false,
        })),
    });

    const result = await createOrder(ops, payload, { nextOrderId: portalNextOrderId(db) });

    remember(result.order);
    console.log(`  ${result.orderId}  ${cargo.description} (${status})`);

    return { orderId: result.orderId, pk: result.order.id };
}

async function orgNames(ids: string[]) {
    const rows = await db.select({ id: organization.id, name: organization.name }).from(organization).where(inArray(organization.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
}

/** A quote Appload registers on behalf of a logbook carrier (what Admin's offer dialog writes). */
async function staffQuote(orderPk: string, quote: StaffOffer & { status?: "pending" | "declined" | "recorded" }, route: Lane["route"]) {
    const names = await orgNames([quote.carrierId]);
    const snapshot = await carrierSnapshot(db, quote.carrierId);
    const id = crypto.randomUUID();
    const carrierName = names.get(quote.carrierId)!;
    const status = quote.status ?? "pending";

    await db.transaction(async (tx) => {
        await tx.insert(orderOffer).values({
            id,
            orderId: orderPk,
            carrierId: quote.carrierId,
            carrierName,
            fiscalRegime: "normal",
            total: String(quote.total),
            currency: "MZN",
            ...offerPricingColumns(priceOffer({ carrierTotal: quote.total, fiscalRegime: "normal", commissionTotal: quote.commission, route })),
            includesGit: quote.git ?? false,
            includesGps: quote.gps ?? false,
            notes: quote.notes ?? null,
            status,
            carrierSince: snapshot.since,
            carrierTrips: snapshot.trips,
            ...(status === "declined" && { decidedAt: new Date(), decidedBy: OPS, decisionNote: "Sem GPS a bordo" }),
            createdBy: OPS,
        });
        await tx.insert(orderHistory).values({
            orderId: orderPk,
            actorUserId: OPS,
            kind: "offer",
            metadata: { action: "created", offerId: id, carrierName, total: String(quote.total), currency: "MZN" },
        });
    });

    return id;
}

/** The carrier quotes from the portal, and Appload prices its commission on top. */
async function carrierQuote(orderId: string, total: number, commission: number, extras: { git?: boolean; gps?: boolean; notes?: string } = {}) {
    const quote = await as(ASM.user).orders.offers.create({
        orderId,
        values: { fiscalRegime: "normal", total, currency: "MZN", includesGit: extras.git ?? false, includesGps: extras.gps ?? true, notes: extras.notes },
    });

    const row = await orderRow(orderId);

    await db
        .update(orderOffer)
        .set(offerPricingColumns(priceOffer({ carrierTotal: total, fiscalRegime: "normal", commissionTotal: commission, route: row.route })))
        .where(eq(orderOffer.id, quote.id));

    await db.insert(orderHistory).values({
        orderId: row.id,
        actorUserId: OPS,
        kind: "offer",
        metadata: { action: "updated", offerId: quote.id, carrierName: "A.S.M. Transportes", total: String(total), currency: "MZN" },
    });

    return quote.id;
}

/** Client asks the carrier, carrier quotes, client accepts: the one way to a booking. */
async function bookWithAsm(orderId: string, total: number, commission: number) {
    const s = as(CTP.user);

    await s.orders.sendRequests({ orderId, carrierOrgIds: [ASM.org] });
    const offerId = await carrierQuote(orderId, total, commission);
    const placed = await s.orders.get({ orderId });
    await s.orders.offers.accept({ orderId, offerId, expectedVersion: placed.version });
}

/** The carrier sends its rig from the portal: the dispatch, with the papers snapshot. */
async function dispatch(orderId: string) {
    const c = as(ASM.user);
    const options = await c.orders.transitionOptions({ orderId });

    await c.orders.transition({ orderId, to: "at-loading", expectedVersion: options.version, dispatch: { driverId: RIG.driverId, truckId: RIG.truckId } });
}

/** The client confirms the truck and driver at the gate. */
async function loadingCheck(orderId: string, verdict: "passed" | "mismatch", withPhoto = false) {
    const s = as(CTP.user);
    const photoDocumentIds: string[] = [];

    if (withPhoto) {
        const photo = await s.orders.documents.add({ orderId, type: "loading-photo", url: fileUrl("carga-01.jpg"), title: "Carga no camião", mimeType: "image/jpeg" });
        photoDocumentIds.push(photo.id);
    }

    const placed = await s.orders.get({ orderId });

    await s.orders.recordLoadingCheck({
        orderId,
        expectedVersion: placed.version,
        items: verdict === "passed"
            ? [{ key: "driver-identity", ok: true }, { key: "rig-plates", ok: true }]
            : [{ key: "driver-identity", ok: false, note: "Motorista diferente do indicado no despacho" }, { key: "rig-plates", ok: true }],
        note: verdict === "passed" ? "Matrículas e motorista conferidos no portão" : "Motorista não corresponde; camião correcto",
        photoDocumentIds,
    });
}

type Step = OrderStatus | { to: OrderStatus; note?: string; pod?: boolean; evidence?: boolean; by?: typeof ops };

/** Moves the order along as Appload, one transition each. */
async function walk(orderId: string, steps: Step[]) {
    for (const step of steps) {
        const { to, note, pod, evidence, by } = typeof step === "string" ? { to: step } as Exclude<Step, string> : step;
        const row = await orderRow(orderId);

        await applyTransition(by ?? ops, {
            orderId,
            to,
            expectedVersion: row.version,
            note,
            ...(pod && { document: { url: fileUrl("POD.pdf"), name: `POD ${orderId}.pdf`, size: 184_320, mimeType: "application/pdf" } }),
            ...(evidence && { document: { url: fileUrl("evidencia.jpg"), name: "Evidência.jpg", size: 512_000, mimeType: "image/jpeg" } }),
        });
    }
}

/** A proof of payment on one leg, and the order's paid columns re-derived from it (what Admin's documents door does). */
async function proofOfPayment(orderPk: string, party: "shipper" | "carrier", amount: number, daysAgo: number, reference: string) {
    await db.insert(orderDocument).values({
        orderId: orderPk,
        type: "proof-of-payment",
        party,
        title: `Comprovativo ${reference}.pdf`,
        url: fileUrl(`comprovativo-${reference}.pdf`),
        mimeType: "application/pdf",
        total: String(amount),
        currency: "MZN",
        reason: reference,
        paidAt: daysFromNow(-daysAgo),
        uploadedBy: OPS,
    });

    const [row] = await db.select().from(order).where(eq(order.id, orderPk));
    const patch = proofPaymentPatch(row!, await paymentSums(db, orderPk));

    await db.update(order).set(patch).where(eq(order.id, orderPk));
    await db.insert(orderHistory).values({
        orderId: orderPk,
        actorUserId: OPS,
        kind: "payment",
        metadata: { party, amount, currency: "MZN", reference },
    });
}

/** Appload opens a dispute on the cargo (what Admin's disputes door writes). */
async function openOrderDispute(orderPk: string, input: { reason: "theft" | "loss" | "damage" | "other"; description: string; claimed: number; liable: "carrier" | "shipper" | "unknown" }) {
    const id = crypto.randomUUID();

    await db.transaction(async (tx) => {
        await tx.insert(orderDispute).values({
            id,
            orderId: orderPk,
            reason: input.reason,
            status: "open",
            description: input.description,
            claimedAmount: String(input.claimed),
            claimedCurrency: "MZN",
            liableParty: input.liable,
            holdShipperPayments: true,
            holdCarrierPayments: true,
            openedBy: OPS,
        });
        await tx.update(order).set({ disputeStatus: "open" }).where(eq(order.id, orderPk));
        await tx.insert(orderHistory).values({
            orderId: orderPk,
            actorUserId: OPS,
            kind: "dispute",
            metadata: { disputeId: id, action: "opened", reason: input.reason, status: "open", holdShipperPayments: true, holdCarrierPayments: true },
        });
    });
}

/** One line in the shipment's chat, then pushed back in time. */
async function say(subject: { subjectType: "order" | "movement"; subjectId: string }, actor: Actor, body: string, hoursAgo: number) {
    const message = await sendMessage(db, { actor, subject, body, attachments: [] });
    const at = new Date(Date.now() - hoursAgo * HOUR);

    await db.update(threadMessage).set({ createdAt: at }).where(eq(threadMessage.id, message.id));
    await db.update(thread).set({ lastMessageAt: at }).where(eq(thread.id, message.threadId));
}

/**
 * Pushes an order's trail back in time: created `agoDays` ago, then every
 * event `stepHours` apart, and the milestone dates on the row set to the
 * moment their transition happened.
 */
async function backdateOrder(orderPk: string, agoDays: number, stepHours: number) {
    const rows = await db
        .select({ id: orderHistory.id, toStatus: orderHistory.toStatus, fromStatus: orderHistory.fromStatus, kind: orderHistory.kind })
        .from(orderHistory)
        .where(eq(orderHistory.orderId, orderPk))
        .orderBy(asc(orderHistory.createdAt));

    const start = Date.now() - agoDays * DAY;
    const stamps: Partial<Record<string, Date>> = {};
    let at = new Date(start);

    for (const [i, row] of rows.entries()) {
        at = new Date(start + i * stepHours * HOUR);
        await db.update(orderHistory).set({ createdAt: at }).where(eq(orderHistory.id, row.id));

        if (row.kind !== "transition") continue;

        switch (row.toStatus) {
            case "booked": stamps.dealDate ??= at; break;
            case "at-loading": stamps.arrivalAtLoading ??= at; break;
            case "loading": stamps.actualLoadingDate ??= at; break;
            case "on-route":
                if (row.fromStatus === "at-border") stamps.departureFromBorder ??= at;
                else stamps.departureLoadingDate ??= at;
                break;
            case "at-border": stamps.arrivalAtBorder ??= at; break;
            case "at-offloading": stamps.arrivalAtOffloading ??= at; break;
            case "offloading": stamps.actualOffloadingDate ??= at; break;
            case "delivered": stamps.departureOffloadingDate ??= at; break;
        }
    }

    const [row] = await db.select({ dealDate: order.dealDate }).from(order).where(eq(order.id, orderPk));

    await db.update(order).set({
        createdAt: new Date(start),
        updatedAt: at,
        ...(row?.dealDate && stamps.dealDate && { dealDate: stamps.dealDate }),
        ...(stamps.arrivalAtLoading && { arrivalAtLoading: stamps.arrivalAtLoading }),
        ...(stamps.actualLoadingDate && { actualLoadingDate: stamps.actualLoadingDate }),
        ...(stamps.departureLoadingDate && { departureLoadingDate: stamps.departureLoadingDate }),
        ...(stamps.arrivalAtBorder && { arrivalAtBorder: stamps.arrivalAtBorder }),
        ...(stamps.departureFromBorder && { departureFromBorder: stamps.departureFromBorder }),
        ...(stamps.arrivalAtOffloading && { arrivalAtOffloading: stamps.arrivalAtOffloading }),
        ...(stamps.actualOffloadingDate && { actualOffloadingDate: stamps.actualOffloadingDate }),
        ...(stamps.departureOffloadingDate && { departureOffloadingDate: stamps.departureOffloadingDate }),
    }).where(eq(order.id, orderPk));

    // The rows that hang off the milestones follow them
    if (stamps.arrivalAtLoading) {
        await db.update(orderDispatch).set({ dispatchedAt: stamps.arrivalAtLoading }).where(eq(orderDispatch.orderId, orderPk));
        await db.update(orderLoadingCheck).set({ checkedAt: new Date(stamps.arrivalAtLoading.getTime() + HOUR) }).where(eq(orderLoadingCheck.orderId, orderPk));
    }
    await db.update(orderOffer).set({ createdAt: new Date(start + HOUR), ...(stamps.dealDate && { decidedAt: stamps.dealDate }) }).where(eq(orderOffer.orderId, orderPk));
    await db.update(orderDispute).set({ openedAt: at, createdAt: at }).where(eq(orderDispute.orderId, orderPk));

    // The two companies' own rows on this order follow the same clock
    const linked = await db.select({ id: movement.id }).from(movement).where(eq(movement.orderId, orderPk));
    for (const row of linked) await backdateMovement(row.id, agoDays, stepHours);
}

/** Same idea for a portal load: its trail and the stamps on the row. */
async function backdateMovement(movementId: string, agoDays: number, stepHours: number) {
    const rows = await db
        .select({ id: movementEvent.id, toStatus: movementEvent.toStatus, kind: movementEvent.kind })
        .from(movementEvent)
        .where(eq(movementEvent.movementId, movementId))
        .orderBy(asc(movementEvent.createdAt));

    const start = Date.now() - agoDays * DAY;
    const stamps: { startedAt?: Date; deliveredAt?: Date; closedAt?: Date; offeredAt?: Date; respondedAt?: Date } = {};
    let at = new Date(start);

    for (const [i, row] of rows.entries()) {
        at = new Date(start + i * stepHours * HOUR);
        await db.update(movementEvent).set({ createdAt: at }).where(eq(movementEvent.id, row.id));

        if (row.toStatus === "at-loading") stamps.startedAt ??= at;
        if (row.toStatus === "delivered") stamps.deliveredAt ??= at;
        if (row.toStatus === "closed") stamps.closedAt ??= at;
        if (row.toStatus === "offered") stamps.offeredAt ??= at;
        if (row.kind === "offer" && (row.toStatus === "scheduled" || row.toStatus === "declined")) stamps.respondedAt ??= at;
    }

    const [row] = await db.select({ startedAt: movement.startedAt, offeredAt: movement.offeredAt, respondedAt: movement.respondedAt }).from(movement).where(eq(movement.id, movementId));

    await db.update(movement).set({
        createdAt: new Date(start),
        updatedAt: at,
        ...(row?.startedAt && stamps.startedAt && { startedAt: stamps.startedAt }),
        ...(stamps.deliveredAt && { deliveredAt: stamps.deliveredAt }),
        ...(stamps.closedAt && { closedAt: stamps.closedAt }),
        ...(row?.offeredAt && stamps.offeredAt && { offeredAt: stamps.offeredAt }),
        ...(row?.respondedAt && stamps.respondedAt && { respondedAt: stamps.respondedAt }),
    }).where(eq(movement.id, movementId));
}

// ---------------------------------------------------------------------------
// The Appload world
// ---------------------------------------------------------------------------

const orderThread = (orderId: string) => ({ subjectType: "order" as const, subjectId: orderId });
const shipper = tenantActor(CTP, "shipper");
const carrier = tenantActor(ASM, "carrier");

async function apploadOrders() {
    console.log("\n— Appload orders");

    // 1. A quote the client just filed, sent out, nobody answered yet
    const awaiting = await clientOrder(L.mapChi, { category: "fmcg", description: "Bebidas engarrafadas, 28 t em paletes", weight: 28, packing: "pallets" }, 6);
    await as(CTP.user).orders.sendRequests({ orderId: awaiting.orderId, carrierOrgIds: [ASM.org], message: "Carga paletizada, carregamento das 07h às 15h." });
    await backdateOrder(awaiting.pk, 1, 2);

    // 2. A quote with three offers on the table: the carrier's own from the
    //    portal, two Appload typed in, one of them already declined
    const offers = await clientOrder(L.nacBei, { category: "agriculture-products", description: "Milho a granel, 30 t", weight: 30, packing: "bags-50kg" }, 5);
    await as(CTP.user).orders.sendRequests({ orderId: offers.orderId, carrierOrgIds: [ASM.org] });
    await carrierQuote(offers.orderId, 48_000, 7_000, { gps: true, notes: "Camião disponível a partir de segunda-feira" });
    await staffQuote(offers.pk, { carrierId: LALGY, total: 52_000, commission: 7_000, git: true, gps: true }, "national");
    await staffQuote(offers.pk, { carrierId: FFS, total: 55_000, commission: 7_000, status: "declined" }, "national");
    await say(orderThread(offers.orderId), shipper, "Bom dia, precisamos do camião no Nacala até sexta. Conseguem?", 30);
    await say(orderThread(offers.orderId), opsActor, "Bom dia. Temos três propostas para vos apresentar, a melhor a 55.000 MZN com IVA e comissão incluídos.", 28);
    await backdateOrder(offers.pk, 3, 6);

    // 3. Booked, waiting for the carrier to name a driver and a truck
    const toDispatch = await clientOrder(L.matNam, { category: "construction", description: "Cimento em sacos, 30 t", weight: 30, packing: "bags-50kg" }, 3);
    await bookWithAsm(toDispatch.orderId, 118_000, 15_000);
    await backdateOrder(toDispatch.pk, 4, 8);

    // 4. Booked by Appload for a logbook client with a carrier that has no
    //    papers on file: the KYC flag, and one offer that lost
    const flagged = await staffOrder(ETC_ADUBOS, L.beiMap, { category: "agriculture-inputs", description: "Adubo NPK, 32 t", weight: 32, packing: "bags-50kg" }, 4, [
        { carrierId: LALGY, total: 62_000, commission: 9_000, git: true, accepted: true },
        { carrierId: UNITRANS, total: 68_000, commission: 9_000 },
    ]);
    await backdateOrder(flagged.pk, 2, 4);

    // 5. Dispatched, truck at the gate, the client has not checked it yet
    const atGate = await clientOrder(L.mapChi, { category: "fmcg", description: "Óleo alimentar, 26 t", weight: 26, packing: "boxes" }, 0);
    await bookWithAsm(atGate.orderId, 60_000, 8_500);
    await dispatch(atGate.orderId);
    await say(orderThread(atGate.orderId), carrier, "Camião AAA 123 MC chegou ao armazém, à espera de doca.", 3);
    await backdateOrder(atGate.pk, 2, 8);

    // 6. At the gate with a mismatch the client recorded: only a manager may let it load
    const mismatch = await clientOrder(L.chiXai, { category: "general-cargo", description: "Mobiliário de escritório, 12 t", weight: 12, packing: "boxes" }, 0);
    await bookWithAsm(mismatch.orderId, 41_000, 6_000);
    await dispatch(mismatch.orderId);
    await loadingCheck(mismatch.orderId, "mismatch");
    await backdateOrder(mismatch.pk, 1, 4);

    // 7. Checked and passed, loading under way, with the loading photo
    const loading = await clientOrder(L.nacBei, { category: "agriculture-products", description: "Castanha de caju, 25 t", weight: 25, packing: "bags-50kg" }, -1);
    await bookWithAsm(loading.orderId, 50_000, 7_000);
    await dispatch(loading.orderId);
    await loadingCheck(loading.orderId, "passed", true);
    await walk(loading.orderId, ["loading"]);
    await backdateOrder(loading.pk, 2, 6);

    // 8. Loaded, waiting on the paperwork before it may leave
    const papers = await clientOrder(L.beiMap, { category: "mining", description: "Concentrado mineral, 30 t", weight: 30, packing: "bags-1ton" }, -1);
    await bookWithAsm(papers.orderId, 66_000, 9_000);
    await dispatch(papers.orderId);
    await loadingCheck(papers.orderId, "passed");
    await walk(papers.orderId, ["loading", { to: "waiting-documents", note: "Guia de trânsito ainda por emitir" }]);
    await backdateOrder(papers.pk, 2, 5);

    // 9. On the road, national: pings along the N1/N6
    const onRoute = await clientOrder(L.mapChi, { category: "fmcg", description: "Produtos de higiene, 24 t", weight: 24, packing: "pallets" }, -2);
    await bookWithAsm(onRoute.orderId, 58_000, 8_000);
    await dispatch(onRoute.orderId);
    await loadingCheck(onRoute.orderId, "passed", true);
    await walk(onRoute.orderId, ["loading", "on-route"]);
    await copyOrderRoute(onRoute.pk, L.mapChi);
    await pingOrder(onRoute.pk, L.mapChi, 0.6);
    await say(orderThread(onRoute.orderId), carrier, "Saímos de Maputo às 06h. Previsão de chegada a Chimoio amanhã ao fim da tarde.", 26);
    await say(orderThread(onRoute.orderId), shipper, "Obrigado. Avisem quando passarem Inchope.", 25);
    await backdateOrder(onRoute.pk, 3, 6);

    // 10. Regional, held at the border
    const border = await clientOrder(L.jhbChi, { category: "machinery-equipment", description: "Peças de equipamento agrícola, 18 t", weight: 18, packing: "pallets" }, -3);
    await bookWithAsm(border.orderId, 95_000, 12_000);
    await dispatch(border.orderId);
    await loadingCheck(border.orderId, "passed");
    await walk(border.orderId, ["loading", "on-route", "at-border"]);
    await copyOrderRoute(border.pk, L.jhbChi);
    await pingOrder(border.pk, L.jhbChi, 0.33, 4);
    await backdateOrder(border.pk, 4, 7);

    // 11. Stopped on the road: a breakdown, resumes to on-route
    const stopped = await clientOrder(L.nacBei, { category: "agriculture-products", description: "Gergelim, 28 t", weight: 28, packing: "bags-50kg" }, -4);
    await bookWithAsm(stopped.orderId, 49_000, 7_000);
    await dispatch(stopped.orderId);
    await loadingCheck(stopped.orderId, "passed");
    await walk(stopped.orderId, ["loading", "on-route", { to: "stopped", note: "Avaria mecânica em Caia — mecânico a caminho" }]);
    await copyOrderRoute(stopped.pk, L.nacBei);
    await pingOrder(stopped.pk, L.nacBei, 0.45, 4);
    await backdateOrder(stopped.pk, 5, 8);

    // 12. An issue on the road: a police stop for missing papers
    const issue = await clientOrder(L.beiMap, { category: "general-cargo", description: "Electrodomésticos, 14 t", weight: 14, packing: "boxes" }, -2);
    await bookWithAsm(issue.orderId, 63_000, 9_000);
    await dispatch(issue.orderId);
    await loadingCheck(issue.orderId, "passed");
    await walk(issue.orderId, ["loading", "on-route", { to: "issue", note: "Fiscalização em Inchope: guia de remessa em falta, cliente contactado" }]);
    await copyOrderRoute(issue.pk, L.beiMap);
    await pingOrder(issue.pk, L.beiMap, 0.3, 3);
    await say(orderThread(issue.orderId), carrier, "Parados em Inchope, a fiscalização pede a guia de remessa original.", 5);
    await say(orderThread(issue.orderId), opsActor, "Já falámos com o cliente, a guia segue por email para o motorista em 20 minutos.", 4);
    await backdateOrder(issue.pk, 3, 6);

    // 13. Arrived at the offloading site
    const arrived = await clientOrder(L.mapPem, { category: "fmcg", description: "Bens de consumo, 30 t", weight: 30, packing: "pallets" }, -6);
    await bookWithAsm(arrived.orderId, 140_000, 18_000);
    await dispatch(arrived.orderId);
    await loadingCheck(arrived.orderId, "passed");
    await walk(arrived.orderId, ["loading", "on-route", "at-offloading"]);
    await copyOrderRoute(arrived.pk, L.mapPem);
    await pingOrder(arrived.pk, L.mapPem, 1, 7);
    await backdateOrder(arrived.pk, 6, 9);

    // 14. Offloading
    const offloading = await clientOrder(L.chiMap, { category: "agriculture-products", description: "Feijão, 27 t", weight: 27, packing: "bags-50kg" }, -5);
    await bookWithAsm(offloading.orderId, 57_000, 8_000);
    await dispatch(offloading.orderId);
    await loadingCheck(offloading.orderId, "passed");
    await walk(offloading.orderId, ["loading", "on-route", "at-offloading", "offloading"]);
    await copyOrderRoute(offloading.pk, L.chiMap);
    await pingOrder(offloading.pk, L.chiMap, 1, 6);
    await backdateOrder(offloading.pk, 6, 8);

    // 15. Delivered, POD still to come
    const delivered = await clientOrder(L.nacBei, { category: "agriculture-products", description: "Amendoim, 26 t", weight: 26, packing: "bags-50kg" }, -7);
    await bookWithAsm(delivered.orderId, 50_000, 7_000);
    await dispatch(delivered.orderId);
    await loadingCheck(delivered.orderId, "passed");
    await walk(delivered.orderId, ["loading", "on-route", "at-offloading", "offloading", "delivered"]);
    await copyOrderRoute(delivered.pk, L.nacBei);
    await pingOrder(delivered.pk, L.nacBei, 1, 6, 30);
    await backdateOrder(delivered.pk, 8, 9);

    // 16. Delivered with damage: a dispute holds both legs
    const disputed = await clientOrder(L.beiMap, { category: "fmcg", description: "Vidro e louça, 16 t", weight: 16, packing: "boxes" }, -8);
    await bookWithAsm(disputed.orderId, 64_000, 9_000);
    await dispatch(disputed.orderId);
    await loadingCheck(disputed.orderId, "passed");
    await walk(disputed.orderId, ["loading", "on-route", "at-offloading", "offloading", "delivered"]);
    await copyOrderRoute(disputed.pk, L.beiMap);
    await pingOrder(disputed.pk, L.beiMap, 1, 6, 40);
    await openOrderDispute(disputed.pk, { reason: "damage", description: "Cerca de 40 caixas partidas na descarga; fotografias enviadas pelo cliente.", claimed: 35_000, liable: "carrier" });
    await say(orderThread(disputed.orderId), shipper, "Recebemos 40 caixas partidas. Enviámos as fotos ao vosso email.", 20);
    await say(orderThread(disputed.orderId), opsActor, "Abrimos um processo de disputa; os pagamentos ficam retidos até apurarmos a responsabilidade.", 19);
    await backdateOrder(disputed.pk, 9, 10);

    // 17. Completed with the POD, the client paid in full, the carrier half
    const completed = await clientOrder(L.mapChi, { category: "fmcg", description: "Bebidas, 28 t", weight: 28, packing: "pallets" }, -13);
    await bookWithAsm(completed.orderId, 60_000, 8_500);
    await dispatch(completed.orderId);
    await loadingCheck(completed.orderId, "passed");
    await walk(completed.orderId, ["loading", "on-route", "at-offloading", "offloading", "delivered", { to: "completed", pod: true, by: manager }]);
    await copyOrderRoute(completed.pk, L.mapChi);
    await proofOfPayment(completed.pk, "shipper", 68_500, 4, "TRF-2026-0412");
    await proofOfPayment(completed.pk, "carrier", 30_000, 3, "TRF-2026-0418");
    await backdateOrder(completed.pk, 14, 10);

    // 18. Completed and settled on both sides
    const settled = await clientOrder(L.nacBei, { category: "agriculture-products", description: "Milho a granel, 30 t", weight: 30, packing: "bags-50kg" }, -19);
    await bookWithAsm(settled.orderId, 48_000, 7_000);
    await dispatch(settled.orderId);
    await loadingCheck(settled.orderId, "passed");
    await walk(settled.orderId, ["loading", "on-route", "at-offloading", "offloading", "delivered", { to: "completed", pod: true, by: manager }]);
    await copyOrderRoute(settled.pk, L.nacBei);
    await proofOfPayment(settled.pk, "shipper", 55_000, 9, "TRF-2026-0388");
    await proofOfPayment(settled.pk, "carrier", 48_000, 7, "TRF-2026-0391");
    await db.update(order).set({ carrierInvoiceNumber: "FT 2026/117", shipperInvoiceNumber: "FT-A 2026/052" }).where(eq(order.id, settled.pk));
    await backdateOrder(settled.pk, 20, 12);

    // 19. Cancelled by the client while still a quote
    const cancelled = await clientOrder(L.chiXai, { category: "construction", description: "Tijolos, 20 t", weight: 20 }, -3);
    await as(CTP.user).orders.sendRequests({ orderId: cancelled.orderId, carrierOrgIds: [ASM.org] });
    const cancelledRow = await as(CTP.user).orders.get({ orderId: cancelled.orderId });
    await as(CTP.user).orders.cancel({ orderId: cancelled.orderId, expectedVersion: cancelledRow.version, note: "Obra adiada, carga sem data" });
    await backdateOrder(cancelled.pk, 5, 12);

    // 20. Lost on price to a competitor
    const underbid = await staffOrder(ETC_ADUBOS, L.mapTet, { category: "agriculture-inputs", description: "Ureia, 30 t", weight: 30, packing: "bags-50kg" }, -4, [
        { carrierId: LALGY, total: 78_000, commission: 10_000 },
    ]);
    await walk(underbid.orderId, [{ to: "underbid", note: "Cliente fechou com concorrente a 82.000 MZN" }]);
    await backdateOrder(underbid.pk, 6, 12);

    // 21. Cancelled after loading: evidence, a note, and the review flag
    const aborted = await clientOrder(L.chiMap, { category: "agriculture-products", description: "Banana, 22 t", weight: 22, packing: "boxes" }, -6);
    await bookWithAsm(aborted.orderId, 56_000, 8_000);
    await dispatch(aborted.orderId);
    await loadingCheck(aborted.orderId, "passed");
    await walk(aborted.orderId, ["loading", { to: "cancelled", note: "Carga rejeitada no carregamento: fruta fora do padrão de exportação", evidence: true, by: manager }]);
    await backdateOrder(aborted.pk, 7, 8);
}

// ---------------------------------------------------------------------------
// The portal world: the two companies' own books
// ---------------------------------------------------------------------------

const movementThread = (movementId: string) => ({ subjectType: "movement" as const, subjectId: movementId });

async function loadVersion(user: string, id: string) {
    return (await as(user).movements.get({ id })).version;
}

/** The carrier walks its own row; the client's follows. */
async function walkLoad(user: string, id: string, steps: (MovementStatus | { to: MovementStatus; note: string })[]) {
    for (const step of steps) {
        const { to, note } = typeof step === "string" ? { to: step, note: undefined } : step;
        const version = await loadVersion(user, id);
        await as(user).movements.transition({ id, to, expectedVersion: version, note });
    }
}

/** A load the client hands to A.S.M. on the portal, answered by A.S.M. */
async function partnerLoad(lane: Lane, cargo: string, buyTotal: number, loadingInDays: number, answer: "none" | "decline" | "accept") {
    const s = as(CTP.user);
    const filed = await s.movements.create({
        execution: "partner",
        carrierOrgId: ASM.org,
        origin: lane.from,
        destination: lane.to,
        route: lane.route,
        category: "general-cargo",
        cargoDescription: cargo,
        weight: 28,
        weightUnit: "ton",
        expectedLoadingDate: daysFromNow(loadingInDays),
        expectedDeliveryAt: daysFromNow(loadingInDays + Math.ceil(lane.km / 450)),
        buy: { total: buyTotal, currency: "MZN", fiscalRegime: "normal" },
    });

    made.movements.push(filed.id);
    saveManifest();

    const offered = await s.movements.offer({ id: filed.id, expectedVersion: await loadVersion(CTP.user, filed.id), message: "Carga pronta no armazém, horário de carregamento das 07h às 16h." });
    console.log(`  ${filed.ref}  ${cargo}`);

    if (answer === "none") return { id: filed.id, executor: null };

    const response = await as(ASM.user).movements.respond({
        id: filed.id,
        expectedVersion: offered.version,
        decision: answer,
        note: answer === "decline" ? "Sem camião disponível nessa data" : undefined,
    });

    if (answer === "decline") return { id: filed.id, executor: null };

    made.movements.push(response.id);
    saveManifest();

    // The carrier names its own rig on its own row
    const version = await loadVersion(ASM.user, response.id);
    await as(ASM.user).movements.update({ id: response.id, expectedVersion: version, driverId: RIG.driverId, truckId: RIG.truckId });

    return { id: filed.id, executor: response.id };
}

async function portalLoads() {
    console.log("\n— portal loads (Cliente Teste Portal ↔ A.S.M. Transportes)");

    const s = as(CTP.user);
    const c = as(ASM.user);

    // a. The client's own truck, still being planned
    const draft = await s.movements.create({
        execution: "own-fleet",
        status: "procurement",
        origin: P.matola,
        destination: P.xaixai,
        cargoDescription: "Transferência entre armazéns, 10 t",
        weight: 10,
        weightUnit: "ton",
        expectedLoadingDate: daysFromNow(4),
    });
    made.movements.push(draft.id);
    console.log(`  ${draft.ref}  own truck, draft`);
    await backdateMovement(draft.id, 1, 1);

    // b. The client's own truck on the road, tracked
    const ownTrip = await s.movements.create({
        execution: "own-fleet",
        status: "booked",
        origin: P.maputo,
        destination: P.chimoio,
        route: "national",
        cargoDescription: "Entrega ao cliente final, 18 t",
        category: "fmcg",
        weight: 18,
        weightUnit: "ton",
        expectedLoadingDate: daysFromNow(-2),
        expectedDeliveryAt: daysFromNow(1),
        driverName: "Motorista Teste",
        driverPhone: DRIVER_PHONE,
        truckPlate: "AAA 123 MC",
        clientName: "Supermercados do Centro",
        clientReference: "PO-4471",
        sell: { total: 45_000, currency: "MZN", fiscalRegime: "normal" },
    });
    made.movements.push(ownTrip.id);
    console.log(`  ${ownTrip.ref}  own truck, on the road`);
    await walkLoad(CTP.user, ownTrip.id, ["at-loading", "loading", "on-route"]);
    await copyMovementRoute(ownTrip.id, L.mapChi);
    await pingMovement(ownTrip.id, L.mapChi, 0.5, 4);
    await s.movements.costs.add({ movementId: ownTrip.id, kind: "fuel", amount: 14_500, currency: "MZN", description: "Gasóleo Maputo" });
    await s.movements.costs.add({ movementId: ownTrip.id, kind: "driver-allowance", amount: 2_500, currency: "MZN" });
    await backdateMovement(ownTrip.id, 3, 8);

    // c. Offered to the carrier, no answer yet
    const offered = await partnerLoad(L.mapChi, "Paletes de bebidas, 28 t", 52_000, 5, "none");
    await backdateMovement(offered.id, 1, 3);

    // d. Declined by the carrier
    const declined = await partnerLoad(L.beiMap, "Ferragens, 20 t", 38_000, 3, "decline");
    await backdateMovement(declined.id, 2, 6);

    // e. Accepted and booked: the carrier's own row, its own ORD number
    const booked = await partnerLoad(L.chiXai, "Sacos de farinha, 26 t", 44_000, 2, "accept");
    await walkLoad(ASM.user, booked.executor!, ["booked"]);
    await backdateMovement(booked.id, 3, 8);
    await backdateMovement(booked.executor!, 3, 8);

    // f. On the road on the carrier's truck: costs, a loading photo approved, chat
    const rolling = await partnerLoad(L.nacBei, "Castanha de caju, 25 t", 50_000, -2, "accept");
    const photo = await as(ASM_MEMBER).movements.documents.add({ movementId: rolling.executor!, type: "loading-photo", url: fileUrl("carga-nacala.jpg"), title: "Carga no camião", mimeType: "image/jpeg" });
    await c.movements.documents.approve({ id: photo.id });
    await walkLoad(ASM.user, rolling.executor!, ["booked", "at-loading", "loading", "on-route"]);
    await copyMovementRoute(rolling.id, L.nacBei);
    await copyMovementRoute(rolling.executor!, L.nacBei);
    await pingMovement(rolling.executor!, L.nacBei, 0.55, 5);
    await c.movements.costs.add({ movementId: rolling.executor!, kind: "fuel", amount: 18_000, currency: "MZN", description: "Gasóleo Nacala" });
    await c.movements.costs.add({ movementId: rolling.executor!, kind: "tolls", amount: 1_200, currency: "MZN", rechargeable: true });
    await say(movementThread(rolling.id), shipper, "O camião já saiu de Nacala?", 20);
    await say(movementThread(rolling.executor!), carrier, "Sim, saiu às 05h30. Chega a Beira amanhã de manhã.", 19);
    await backdateMovement(rolling.id, 4, 8);
    await backdateMovement(rolling.executor!, 4, 8);

    // g. Delivered, paid in two instalments, closed on both sides; the POD and the invoice on file
    const closed = await partnerLoad(L.chiMap, "Feijão, 27 t", 46_000, -8, "accept");
    await walkLoad(ASM.user, closed.executor!, ["booked", "at-loading", "loading", "on-route", "at-offloading", "offloading", "delivered"]);
    await c.movements.documents.add({ movementId: closed.executor!, type: "pod", url: fileUrl("POD.pdf"), title: "POD assinado.pdf", mimeType: "application/pdf" });
    await c.movements.documents.add({ movementId: closed.executor!, type: "invoice", leg: "sell", url: fileUrl("factura.pdf"), title: "FT 2026/121.pdf", mimeType: "application/pdf" });
    const half = await s.movements.recordPayment({ id: closed.id, expectedVersion: await loadVersion(CTP.user, closed.id), leg: "buy", amount: 23_000, reference: "TRF-0455 adiantamento" });
    const rest = await s.movements.recordPayment({ id: closed.id, expectedVersion: half.version, leg: "buy", amount: 23_000, reference: "TRF-0471 saldo" });
    await s.movements.transition({ id: closed.id, to: "closed", expectedVersion: rest.version });
    const received = await c.movements.recordPayment({ id: closed.executor!, expectedVersion: await loadVersion(ASM.user, closed.executor!), leg: "sell", amount: 46_000, reference: "Recebido por transferência" });
    await c.movements.transition({ id: closed.executor!, to: "closed", expectedVersion: received.version });
    await backdateMovement(closed.id, 10, 10);
    await backdateMovement(closed.executor!, 10, 10);

    // h. Delivered with a dispute the client opened: neither side can close
    const disputed = await partnerLoad(L.beiMap, "Vidro e louça, 16 t", 40_000, -5, "accept");
    await walkLoad(ASM.user, disputed.executor!, ["booked", "at-loading", "loading", "on-route", "at-offloading", "offloading", "delivered"]);
    await s.movements.disputes.open({ movementId: disputed.id, reason: "damage", description: "Cerca de 40 caixas partidas na descarga. Fotografias em anexo no email." });
    await backdateMovement(disputed.id, 7, 9);
    await backdateMovement(disputed.executor!, 7, 9);

    // i. A partner that is not on the portal: scheduled by hand, driver typed in
    const offline = await s.movements.create({
        execution: "partner",
        status: "scheduled",
        carrierName: "Transportes Maningue Nice, Lda",
        origin: P.maputo,
        destination: P.tete,
        route: "national",
        category: "construction",
        cargoDescription: "Estruturas metálicas, 24 t",
        weight: 24,
        weightUnit: "ton",
        expectedLoadingDate: daysFromNow(3),
        driverName: "Carlos Mondlane",
        driverPhone: DRIVER_PHONE,
        truckPlate: "AEK 402 MP",
        buy: { total: 85_000, currency: "MZN", fiscalRegime: "simplified-3" },
        sell: { total: 98_000, currency: "MZN", fiscalRegime: "normal" },
        clientName: "Construções do Zambeze",
    });
    made.movements.push(offline.id);
    console.log(`  ${offline.ref}  off-platform partner, scheduled`);
    await backdateMovement(offline.id, 2, 4);

    saveManifest();
}

// ---------------------------------------------------------------------------
// Nothing this seed writes may put a WhatsApp on a real phone
// ---------------------------------------------------------------------------

/**
 * Takes the demo's trucks off both tracking crons, which run live against
 * this database twice a day.
 *
 * The rig on every seeded load is the portal carrier's test driver, whose
 * number nobody in this office owns — a demo left on the cron would send him
 * "onde está o camião?" every morning, billed, forever. The trails the map
 * draws are written by hand above (source "manual"), so the demo loses
 * nothing by being silent.
 *
 * Two different levers, because the two runners are not alike: a movement has
 * `tracking_enabled`, so its driver stays on the page and merely stops being
 * asked; an order has no such column (run-slot.ts selects on the phone being
 * there at all), so the phone itself has to go. The order keeps its driver's
 * name and its plates, which is all any of the demo screens read.
 */
/**
 * More trucks on the road, one per lane the base seed leaves empty, each with
 * a trail of positions ending an hour ago — six Appload orders A.S.M. runs
 * and two of the client's own trucks. `--more-on-route` appends them to the
 * seed already on the database.
 */
async function moreOnRoute() {
    console.log("\n— more trucks on the road");

    const orders: [Lane, Cargo, number, number][] = [
        [L.mapPem, { category: "fmcg", description: "Arroz, 28 t", weight: 28, packing: "bags-50kg" }, 0.45, 5],
        [L.matNam, { category: "construction", description: "Cimento em sacos, 30 t", weight: 30, packing: "pallets" }, 0.7, 4],
        [L.mapTet, { category: "mining", description: "Equipamento mineiro, 22 t", weight: 22, packing: "other" }, 0.3, 2],
        [L.jhbMap, { category: "general-cargo", description: "Electrodomésticos, 15 t", weight: 15, packing: "pallets" }, 0.8, 1],
        [L.chiMap, { category: "agriculture-products", description: "Banana, 20 t", weight: 20, packing: "boxes" }, 0.55, 3],
        [L.nacBei, { category: "agriculture-products", description: "Milho a granel, 30 t", weight: 30 }, 0.25, 2],
    ];

    for (const [lane, cargo, progress, days] of orders) {
        const o = await clientOrder(lane, cargo, -days);
        await bookWithAsm(o.orderId, Math.round(lane.km * 48 / 1000) * 1000, 8_000);
        await dispatch(o.orderId);
        await loadingCheck(o.orderId, "passed", true);
        await walk(o.orderId, ["loading", "on-route"]);
        await copyOrderRoute(o.pk, lane);
        await pingOrder(o.pk, lane, progress, 6, 1, 4);
        await backdateOrder(o.pk, days + 1, 6);
        console.log(`  ${o.orderId}  ${cargo.description}, on the road ${lane.from.state} → ${lane.to.state}`);
    }

    const own: [Lane, string, number, number][] = [
        [L.beiMap, "Entrega Maputo, 16 t", 0.4, 2],
        [L.chiXai, "Entrega Xai-Xai, 20 t", 0.65, 1],
    ];

    for (const [lane, description, progress, days] of own) {
        const trip = await as(CTP.user).movements.create({
            execution: "own-fleet",
            status: "booked",
            origin: lane.from,
            destination: lane.to,
            route: lane.route,
            cargoDescription: description,
            category: "fmcg",
            weight: Number(description.match(/(\d+) t/)![1]),
            weightUnit: "ton",
            expectedLoadingDate: daysFromNow(-days),
            expectedDeliveryAt: daysFromNow(2),
            driverName: "Motorista Teste",
            driverPhone: DRIVER_PHONE,
            truckPlate: "AAA 123 MC",
            clientName: "Supermercados do Centro",
            clientReference: `PO-${4480 + days}`,
            sell: { total: Math.round(lane.km * 40 / 1000) * 1000, currency: "MZN", fiscalRegime: "normal" },
        });
        made.movements.push(trip.id);
        await walkLoad(CTP.user, trip.id, ["at-loading", "loading", "on-route"]);
        await copyMovementRoute(trip.id, lane);
        await pingMovement(trip.id, lane, progress, 6, 1, 4);
        await backdateMovement(trip.id, days + 1, 6);
        console.log(`  ${trip.ref}  own truck, on the road ${lane.from.state} → ${lane.to.state}`);
    }
}

/**
 * Alerts on trucks the seed already has on the road, the two kinds the
 * portal raises: a driver answering from 30 km off the planned route (an
 * off-route alert for this slot), and one asked this morning who has not
 * answered, last seen yesterday (silent today). The client's own trucks get
 * one of each; the carrier's own row on the road goes off route.
 */
async function alerts() {
    console.log("\n— alerts");

    const local = new Date(Date.now() + 2 * HOUR);
    const slotDate = local.toISOString().slice(0, 10);
    const slot = local.getUTCHours() < 17 ? "morning" as const : "afternoon" as const;

    const onTheRoad = (org: string) => db
        .select({ id: movement.id, reference: movement.reference })
        .from(movement)
        .where(and(inArray(movement.id, made.movements), eq(movement.organizationId, org), eq(movement.status, "on-route"), isNull(movement.orderId), isNull(movement.executionMovementId)))
        .orderBy(asc(movement.reference));

    const [clientOffRoute, clientSilent] = await onTheRoad(CTP.org);
    const [carrierOffRoute] = await onTheRoad(ASM.org);

    if (!clientOffRoute || !clientSilent || !carrierOffRoute) throw new Error("not enough of the seed's own trucks on the road — run --more-on-route first");

    for (const load of [clientOffRoute, carrierOffRoute]) {
        const [last] = await db.select().from(movementLocation).where(eq(movementLocation.movementId, load.id)).orderBy(desc(movementLocation.recordedAt)).limit(1);
        if (!last) throw new Error(`${load.reference} has no positions to stray from`);

        await db.insert(movementLocation).values({ movementId: load.id, latitude: last.latitude, longitude: last.longitude + 0.3, source: "manual", recordedAt: new Date(Date.now() - HOUR / 2) });
        await db.insert(movementTrackingAlert).values({ movementId: load.id, slotDate, slot, issue: "off-route", streak: 1 }).onConflictDoNothing();
        console.log(`  ${load.reference}  off its route`);
    }

    await db.update(movementLocation).set({ recordedAt: sql`${movementLocation.recordedAt} - interval '1 day'` }).where(eq(movementLocation.movementId, clientSilent.id));
    await db
        .insert(movementTrackingRequest)
        .values({ movementId: clientSilent.id, slotDate, slot: "morning", attempt: 1, channel: "whatsapp", status: "delivered", scheduledFor: new Date(`${slotDate}T06:00:00Z`) })
        .onConflictDoNothing();
    console.log(`  ${clientSilent.reference}  silent since yesterday`);
}

// ---------------------------------------------------------------------------
// Contracts: the standing agreements the loads above could have been filed under
// ---------------------------------------------------------------------------

/**
 * Two contracts, one each way. The client's tonnage contract on the
 * Maputo–Beira lane is split between A.S.M. (on the portal) and a typed
 * transporter, and trips under each share draw it down: a delivered one, one
 * on the road, one still a draft. A.S.M.'s own per-trip contract with the
 * client is moved by its own fleet, one trip delivered. Every trip goes
 * through the real doors with the share's defaults, so the pages show what
 * a user would have got.
 */
async function demoContracts() {
    console.log("\n— contracts (Cliente Teste Portal ↔ A.S.M. Transportes)");

    const s = as(CTP.user);
    const c = as(ASM.user);

    // a. The client's tonnage contract, split two ways
    const tonnage = await s.contracts.create({
        basis: "weight",
        origin: P.maputo,
        destination: P.beira,
        startsOn: isoDay(daysFromNow(-20)),
        endsOn: isoDay(daysFromNow(70)),
        committedQty: 2_000,
        currency: "MZN",
        fiscalRegime: "normal",
        clientReference: "CT-2026-MAP-BEI",
        notes: "Cimento a granel, Maputo → Beira, 2 000 t no trimestre.",
    });
    made.contracts?.push(tonnage.id);
    const asmShare = await s.contracts.allocations.add({ contractId: tonnage.id, carrierOrgId: ASM.org, shareQty: 1_200, buyPrice: { model: "per-ton", rate: 1_500 } });
    const lalgyShare = await s.contracts.allocations.add({ contractId: tonnage.id, carrierName: "Transportes Lalgy", shareQty: 800, buyPrice: { model: "per-ton", rate: 1_400 } });
    await s.contracts.transition({ id: tonnage.id, to: "active", expectedVersion: 1 });
    console.log(`  ${tonnage.ref}  2 000 t Maputo → Beira, split 1 200 / 800`);

    // Under the typed transporter's share the client runs the whole trip itself
    const delivered = await s.movements.create({
        execution: "partner",
        status: "booked",
        contractAllocationId: lalgyShare.id,
        origin: P.maputo,
        destination: P.beira,
        route: "national",
        cargoDescription: "Cimento a granel, 30 t",
        category: "construction",
        weight: 30,
        weightUnit: "ton",
        expectedLoadingDate: daysFromNow(-12),
        expectedDeliveryAt: daysFromNow(-9),
        driverName: "Amade Lalgy",
        driverPhone: DRIVER_PHONE,
        truckPlate: "ACD 221 MP",
    });
    made.movements.push(delivered.id);
    await walkLoad(CTP.user, delivered.id, ["at-loading", "loading", "on-route", "at-offloading", "offloading", "delivered"]);
    await copyMovementRoute(delivered.id, L.beiMap);
    await backdateMovement(delivered.id, 12, 10);
    console.log(`  ${delivered.ref}  30 t under the typed share, delivered`);

    const rolling = await s.movements.create({
        execution: "partner",
        status: "booked",
        contractAllocationId: lalgyShare.id,
        origin: P.maputo,
        destination: P.beira,
        route: "national",
        cargoDescription: "Cimento a granel, 32 t",
        category: "construction",
        weight: 32,
        weightUnit: "ton",
        expectedLoadingDate: daysFromNow(-1),
        expectedDeliveryAt: daysFromNow(2),
        driverName: "Amade Lalgy",
        driverPhone: DRIVER_PHONE,
        truckPlate: "ACD 221 MP",
    });
    made.movements.push(rolling.id);
    await walkLoad(CTP.user, rolling.id, ["at-loading", "loading", "on-route"]);
    await copyMovementRoute(rolling.id, L.beiMap);
    await pingMovement(rolling.id, L.beiMap, 0.4, 3);
    await backdateMovement(rolling.id, 1, 6);
    console.log(`  ${rolling.ref}  32 t under the typed share, on the road`);

    // Under A.S.M.'s share the trip is filed and waits to be offered
    const planned = await s.movements.create({
        execution: "partner",
        status: "procurement",
        contractAllocationId: asmShare.id,
        origin: P.maputo,
        destination: P.beira,
        route: "national",
        cargoDescription: "Cimento a granel, 30 t",
        category: "construction",
        weight: 30,
        weightUnit: "ton",
        expectedLoadingDate: daysFromNow(5),
    });
    made.movements.push(planned.id);
    console.log(`  ${planned.ref}  30 t under A.S.M.'s share, to be offered`);

    // b. A.S.M.'s own per-trip contract with the client, its own fleet
    const perTrip = await c.contracts.create({
        basis: "trips",
        clientOrgId: CTP.org,
        origin: P.beira,
        destination: P.maputo,
        startsOn: isoDay(daysFromNow(-40)),
        endsOn: isoDay(daysFromNow(50)),
        committedQty: 12,
        currency: "MZN",
        fiscalRegime: "normal",
        sellPrice: { model: "per-trip", rate: 48_000 },
        notes: "Retornos Beira → Maputo, 12 viagens.",
    });
    made.contracts?.push(perTrip.id);
    const ownShare = await c.contracts.allocations.add({ contractId: perTrip.id, shareQty: 12, truckId: RIG.truckId, driverId: RIG.driverId });
    await c.contracts.transition({ id: perTrip.id, to: "active", expectedVersion: 1 });
    console.log(`  ${perTrip.ref}  12 trips Beira → Maputo, own fleet`);

    const ownTrip = await c.movements.create({
        execution: "own-fleet",
        status: "booked",
        contractAllocationId: ownShare.id,
        origin: P.beira,
        destination: P.maputo,
        route: "national",
        cargoDescription: "Retorno, 28 t",
        category: "construction",
        weight: 28,
        weightUnit: "ton",
        expectedLoadingDate: daysFromNow(-6),
        expectedDeliveryAt: daysFromNow(-4),
    });
    made.movements.push(ownTrip.id);
    await walkLoad(ASM.user, ownTrip.id, ["at-loading", "loading", "on-route", "at-offloading", "offloading", "delivered"]);
    await copyMovementRoute(ownTrip.id, L.beiMap);
    await backdateMovement(ownTrip.id, 6, 8);
    console.log(`  ${ownTrip.ref}  own-fleet trip under the per-trip contract, delivered`);
}

/** A Date as the contract doors take a day: "YYYY-MM-DD" in local time. */
const isoDay = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

async function hushTracking() {
    console.log("\n— taking the demo's trucks off the tracking crons");

    const orderStatuses: OrderStatus[] = ["on-route", "stopped", "issue", "at-border", "at-offloading", "offloading"];
    const loadStatuses: MovementStatus[] = ["on-route", "stopped", "issue", "at-border", "at-offloading", "offloading"];

    const hushedOrders = made.orders.length > 0
        ? await db
            .update(order)
            .set({ driverPhoneNumber: null })
            .where(and(inArray(order.id, made.orders), inArray(order.status, orderStatuses)))
            .returning({ orderId: order.orderId })
        : [];

    // Every row the seed owns, its Appload mirrors included: a mirror carries
    // `order_id`, which the movement runner already skips, but a row that
    // stops being a mirror should not quietly start ringing
    const linked = made.orders.length > 0
        ? (await db.select({ id: movement.id }).from(movement).where(inArray(movement.orderId, made.orders))).map((row) => row.id)
        : [];
    const loads = [...new Set([...made.movements, ...linked])];

    const hushedLoads = loads.length > 0
        ? await db
            .update(movement)
            .set({ trackingEnabled: false })
            .where(and(inArray(movement.id, loads), inArray(movement.status, loadStatuses)))
            .returning({ reference: movement.reference })
        : [];

    console.log(`  ${hushedOrders.length} orders lost their driver's number: ${hushedOrders.map((row) => row.orderId).join(", ") || "none"}`);
    console.log(`  ${hushedLoads.length} loads have tracking off: ${hushedLoads.map((row) => row.reference).join(", ") || "none"}`);
}

// ---------------------------------------------------------------------------
// --reset: everything the last run wrote, in FK order
// ---------------------------------------------------------------------------

async function reset() {
    if (!fs.existsSync(MANIFEST)) {
        console.log("nothing to reset: no manifest");
        return;
    }

    const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as Manifest;
    console.log(`reset: ${manifest.orders.length} orders, ${manifest.movements.length} loads, ${manifest.kycDocs.length} papers (${manifest.sessionId})`);

    // Every load this seed's orders opened for the two companies, plus the seed's own
    const linked = manifest.orders.length > 0
        ? (await db.select({ id: movement.id }).from(movement).where(inArray(movement.orderId, manifest.orders))).map((r) => r.id)
        : [];
    const loads = [...new Set([...manifest.movements, ...linked])];

    if (loads.length > 0) {
        const threads = (await db.select({ id: thread.id }).from(thread).where(and(eq(thread.subjectType, "movement"), inArray(thread.subjectId, loads)))).map((r) => r.id);
        await deleteThreads(threads);
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

    // The loads are gone; the contracts they drew down go after them
    if (manifest.contracts && manifest.contracts.length > 0) {
        await db.delete(contractAllocation).where(inArray(contractAllocation.contractId, manifest.contracts));
        await db.delete(contract).where(inArray(contract.id, manifest.contracts));
    }

    if (manifest.orderIds.length > 0) {
        const threads = (await db.select({ id: thread.id }).from(thread).where(and(eq(thread.subjectType, "order"), inArray(thread.subjectId, manifest.orderIds)))).map((r) => r.id);
        await deleteThreads(threads);
        await db.delete(notification).where(and(eq(notification.entityType, "order"), inArray(notification.entityId, manifest.orderIds)));
        // The driver's WhatsApp thread is the tenant's own; only its link to a demo order goes
        await db.update(chatConversation).set({ orderId: null }).where(inArray(chatConversation.orderId, manifest.orderIds));
    }

    if (manifest.orders.length > 0) {
        await db.delete(trackingRequest).where(inArray(trackingRequest.orderId, manifest.orders));
        await db.delete(orderLocation).where(inArray(orderLocation.orderId, manifest.orders));
        await db.delete(subscriptionUsage).where(and(eq(subscriptionUsage.entityType, "order"), inArray(subscriptionUsage.entityId, manifest.orders)));
        await db.delete(orderLoadingCheck).where(inArray(orderLoadingCheck.orderId, manifest.orders));
        await db.delete(orderDispatch).where(inArray(orderDispatch.orderId, manifest.orders));
        await db.delete(orderDispute).where(inArray(orderDispute.orderId, manifest.orders));
        await db.delete(orderHistory).where(inArray(orderHistory.orderId, manifest.orders));
        await db.delete(orderDocument).where(inArray(orderDocument.orderId, manifest.orders));
        await db.delete(sheetSync).where(inArray(sheetSync.orderId, manifest.orders));
        // Offers, requests and the route cache cascade off the order
        await db.delete(order).where(inArray(order.id, manifest.orders));
    }

    await db.delete(activityLog).where(eq(activityLog.sessionId, manifest.sessionId));

    if (manifest.kycDocs.length > 0) {
        await db.delete(kycDocument).where(inArray(kycDocument.id, manifest.kycDocs));
        console.log("  company", await rederive("organization", ASM.org));
        console.log("  driver ", await rederive("driver", RIG.driverId));
        console.log("  truck  ", await rederive("truck", RIG.truckId));
    }

    fs.unlinkSync(MANIFEST);
    console.log("reset done");
}

async function deleteThreads(ids: string[]) {
    if (ids.length === 0) return;
    await db.delete(threadMessage).where(inArray(threadMessage.threadId, ids));
    await db.delete(threadRead).where(inArray(threadRead.threadId, ids));
    await db.delete(threadParticipant).where(inArray(threadParticipant.threadId, ids));
    await db.delete(thread).where(inArray(thread.id, ids));
}

// ---------------------------------------------------------------------------

async function main() {
    const databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL!).pathname.slice(1));
    console.log(`database: ${databaseName}`);

    // Seeds and resets write and delete by hand: never anywhere but dev
    if (!/dev/i.test(databaseName)) throw new Error(`refusing to seed the demo into "${databaseName}"`);

    if (RESET) {
        await reset();
        return;
    }

    if (MORE || ALERTS) {
        if (!fs.existsSync(MANIFEST)) throw new Error("--more-on-route and --alerts add to a seed: run --yes first");
        Object.assign(made, JSON.parse(fs.readFileSync(MANIFEST, "utf8")));
        if (MORE) await moreOnRoute();
        if (ALERTS) await alerts();
        await hushTracking();
        await Promise.allSettled(logged.splice(0));
        saveManifest();
        console.log(`\nnow ${made.orders.length} orders and ${made.movements.length} loads — manifest at ${MANIFEST}`);
        return;
    }

    if (fs.existsSync(MANIFEST)) {
        console.log("a seed is already on this database (seed-demo.manifest.json) — run --reset first");
        process.exitCode = 1;
        return;
    }

    if (!WRITE) {
        console.log("DRY RUN — would seed: A.S.M. papers (verified), 21 Appload orders (one per stage: quotes with and without offers,");
        console.log("booked, KYC-flagged, at the gate, loading mismatch, loading, waiting documents, on the road, border, stopped, issue,");
        console.log("at offloading, offloading, delivered, disputed, completed ×2, cancelled, underbid, cancelled after loading),");
        console.log("9 portal loads (own truck draft + on the road, partner offered / declined / booked / on the road / closed / disputed,");
        console.log("off-platform partner), chats on both. Re-run with --yes to write.");
        return;
    }

    // Referenced from the sanity check below, and unused otherwise: a rig
    // that does not exist would fail every dispatch with a confusing error
    const [rigDriver] = await db.select({ id: driver.id }).from(driver).where(and(eq(driver.id, RIG.driverId), eq(driver.carrierId, ASM.org)));
    const [rigTruck] = await db.select({ id: truck.id }).from(truck).where(and(eq(truck.id, RIG.truckId), eq(truck.carrierId, ASM.org)));

    if (!rigDriver || !rigTruck) throw new Error("A.S.M.'s test driver or truck is missing on this database");

    saveManifest();

    await verifyCarrier();
    await apploadOrders();
    await portalLoads();
    await demoContracts();
    await hushTracking();

    await Promise.allSettled(logged.splice(0));
    saveManifest();

    console.log(`\nseeded ${made.orders.length} orders, ${made.movements.length} loads and ${made.contracts?.length ?? 0} contracts — manifest at ${MANIFEST}`);
}

main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch(async (error) => {
        console.error("\nseed failed:", error);
        // A half-written seed must not ring the test driver either
        await hushTracking().catch((hushError: unknown) => console.error("hush failed:", hushError));
        // Whatever landed before the failure is in the manifest; --reset takes it away
        await Promise.allSettled(logged.splice(0));
        saveManifest();
        process.exit(1);
    });
