/**
 * End-to-end check of the progress and ETA on tracked loads
 * (`verify-tracking-progress`): drives the portal's movements and map
 * routers as the portal test tenants on the SHARED DEV DATABASE — a shipper
 * (A) handing loads to a carrier (B), whose own truck moves them.
 *
 * What it proves: the arithmetic on its own (halfway along a road is half
 * the distance, an ETA at the pace kept, none in the first hour, straight
 * lines when there is no road, the end of the due day); a road already
 * cached is not bought again when the truck leaves, and a lane Google
 * cannot draw never blocks the dispatch; the trail carries the progress and
 * the map its remaining kilometres; the round's review files a truck
 * arriving after its date as falling behind and tells the client at once,
 * and leaves a truck on time alone.
 *
 * Every row it writes is deleted at the end, pass or fail.
 *
 * Run from apps/app:
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/verify-tracking-progress.ts
 */
import fs from "node:fs";

import { and, eq, inArray } from "drizzle-orm";

import { activityLog } from "@workspace/db/activity-log";
import { db } from "@workspace/db/db";
import {
    movement,
    movementCost,
    movementDocument,
    movementEvent,
    movementLocation,
    movementRequest,
    movementRoute,
    movementTrackingAlert,
    movementTrackingRequest,
} from "@workspace/db/movements";
import { notification } from "@workspace/db/notifications";
import { subscriptionUsage } from "@workspace/db/subscriptions";
import { reviewMovementSlot } from "@workspace/domain/tracking/movement-review";
import { dueBy, movementProgress } from "@workspace/domain/tracking/progress";
import { channelFor, MAX_ATTEMPTS, slotStart, type SlotInfo } from "@workspace/domain/tracking/slot";
import { haversineMeters } from "@workspace/maps/lib/geometry";
import { createCallerFactory } from "@workspace/trpc/init";
import { getStaffGates } from "@workspace/trpc/staff-gate";
import { getTenantGates } from "@workspace/trpc/tenant-gate";

import { mapRouter } from "@/frontend/pages/map/server/procedures";
import { movementsRouter } from "@/frontend/pages/movements/server/procedures";

process.env.DATABASE_URL ??= fs.readFileSync(".env", "utf8").match(/^DATABASE_URL=(.+)$/m)![1]!.trim();

const SESSION_ID = "verify-tracking-progress";
const createMovementsCaller = createCallerFactory(movementsRouter);
const createMapCaller = createCallerFactory(mapRouter);

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

const loads = (userId: string) => createMovementsCaller(contextFor(userId));
const map = (userId: string) => createMapCaller(contextFor(userId));

const A = { user: "FT7QysKKfs5NKuut5i2S8Nhg6ItrwyuR", org: "42655a3f-0bd5-4e46-af29-9c5ee342a8aa" }; // shipper, owner
const B = { user: "a2R9UNA2NTiEo3FS7DxlwgBFUn8EDNU6", org: "9b7674e5-ea7b-416b-a199-6ca6842da718" }; // carrier, owner

const origin = { state: "Nampula Province", address: "Nampula, Mozambique", country: "Mozambique", placeId: "ChIJOaE2a7M1xhgRdN3KTEt2F8I" };
const destination = { state: "Gauteng", address: "Johannesburg, South Africa", country: "South Africa", placeId: "ChIJUWpA8GgMlR4RQUDTsdnJiiM" };
const elsewhere = { state: "Sofala", address: "Beira, Mozambique", country: "Mozambique", placeId: "ChIJ-harness-beira" };

// A straight road (-15,39) → (-16,40), encoded at the usual 1e-5 precision — about 155 km
const ROAD = { from: { lat: -15, lng: 39 }, to: { lat: -16, lng: 40 }, polyline: "~tpzA_e`mF~hbE_ibE" };
const ROAD_METERS = Math.round(haversineMeters(ROAD.from, ROAD.to));
const MIDWAY = { lat: -15.5, lng: 39.5 };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const movementsHere: string[] = [];
const results: { name: string; ok: boolean; detail?: string }[] = [];

function check(name: string, ok: boolean, detail?: unknown) {
    results.push({ name, ok, detail: ok ? undefined : JSON.stringify(detail) });
    console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : ` — ${JSON.stringify(detail)}`}`);
}

const near = (got: number, want: number, tolerance: number) => Math.abs(got - want) <= tolerance;

/**
 * A load of A's handed to B on the portal and accepted: B's own row, with
 * A as its client, the truck B names, and the date the client asked for.
 */
async function ownTruck(input: { lane: { from: typeof origin; to: typeof destination }; due: Date; phone: string; description: string }) {
    const order = await loads(A.user).create({
        execution: "partner",
        carrierOrgId: B.org,
        origin: input.lane.from,
        destination: input.lane.to,
        route: "regional",
        cargoDescription: input.description,
        weight: 20,
        weightUnit: "ton",
        expectedLoadingDate: new Date(Date.now() - 2 * DAY),
        expectedDeliveryAt: input.due,
        buy: { total: 90_000, currency: "MZN" },
    });
    movementsHere.push(order.id);
    const placed = await loads(A.user).get({ id: order.id });
    const offered = await loads(A.user).offer({ id: order.id, expectedVersion: placed.version });
    const accepted = await loads(B.user).respond({ id: order.id, expectedVersion: offered.version, decision: "accept" });
    movementsHere.push(accepted.id);

    const { version } = await loads(B.user).get({ id: accepted.id });
    await loads(B.user).update({
        id: accepted.id, expectedVersion: version,
        driverName: "HARNESS Driver", driverPhone: input.phone, truckPlate: "HRN 001 MC",
    });

    return { id: accepted.id, order: order.id };
}

/** The straight road, cached for the load as if Google had drawn it. */
const cacheRoad = (movementId: string, lane: { from: typeof origin; to: typeof destination }) =>
    db.insert(movementRoute).values({
        movementId,
        originPlaceId: lane.from.placeId,
        destinationPlaceId: lane.to.placeId,
        originLat: ROAD.from.lat, originLng: ROAD.from.lng,
        destinationLat: ROAD.to.lat, destinationLng: ROAD.to.lng,
        encodedPolyline: ROAD.polyline,
        distanceMeters: ROAD_METERS,
        durationSeconds: 3 * 3600,
        source: "routes",
        computedAt: new Date("2026-09-01T00:00:00Z"),
    });

async function walkOut(id: string) {
    for (const to of ["booked", "at-loading", "loading", "on-route"] as const) {
        const { version } = await loads(B.user).get({ id });
        await loads(B.user).transition({ id, to, expectedVersion: version });
    }
}

/** The moment the truck left, moved back so the pace has hours behind it. */
const departedAt = (id: string, at: Date) =>
    db.update(movementEvent).set({ createdAt: at }).where(and(eq(movementEvent.movementId, id), eq(movementEvent.toStatus, "on-route")));

const ping = (movementId: string, at: { lat: number; lng: number }, recordedAt: Date) =>
    db.insert(movementLocation).values({ movementId, latitude: at.lat, longitude: at.lng, placeName: null, recordedAt });

/** A slot's last attempt, reached, written an hour ago so the review will judge it. */
const asked = (info: SlotInfo, movementId: string) =>
    db.insert(movementTrackingRequest).values({
        movementId, slotDate: info.slotDate, slot: info.slot,
        attempt: MAX_ATTEMPTS, channel: channelFor(MAX_ATTEMPTS), status: "responded",
        scheduledFor: slotStart(info), createdAt: new Date(Date.now() - HOUR),
    });

const alertOn = async (info: SlotInfo, movementId: string) => {
    const [row] = await db
        .select({ issue: movementTrackingAlert.issue, streak: movementTrackingAlert.streak })
        .from(movementTrackingAlert)
        .where(and(eq(movementTrackingAlert.movementId, movementId), eq(movementTrackingAlert.slotDate, info.slotDate), eq(movementTrackingAlert.slot, info.slot)));
    return row;
};

const toldAt = (org: string, movementId: string) => db
    .select({ id: notification.id })
    .from(notification)
    .where(and(eq(notification.organizationId, org), eq(notification.kind, "movement.location-alert"), eq(notification.entityId, movementId)));

async function main() {
    // 0. The arithmetic on its own
    const now = new Date();
    const path = [ROAD.from, ROAD.to];
    const halfway = { ...MIDWAY, recordedAt: now };
    const tenHoursAgo = new Date(now.getTime() - 10 * HOUR);

    const mid = movementProgress({ path, totalMeters: ROAD_METERS, origin: ROAD.from, destination: ROAD.to, latest: halfway, departedAt: tenHoursAgo, dueAt: null });
    check("halfway along the road is half the distance", near(mid.coveredMeters, ROAD_METERS / 2, ROAD_METERS * 0.01) && !mid.approximate, mid);
    check("the eta keeps the pace so far", mid.etaAt !== null && near(mid.etaAt.getTime(), now.getTime() + 10 * HOUR, 10 * 60_000), mid);
    check("behind when the pace misses the date",
        movementProgress({ path, totalMeters: ROAD_METERS, origin: ROAD.from, destination: ROAD.to, latest: halfway, departedAt: tenHoursAgo, dueAt: new Date(now.getTime() + 5 * HOUR) }).behind
        && !movementProgress({ path, totalMeters: ROAD_METERS, origin: ROAD.from, destination: ROAD.to, latest: halfway, departedAt: tenHoursAgo, dueAt: new Date(now.getTime() + 15 * HOUR) }).behind);
    check("no eta in the first hour", movementProgress({ path, totalMeters: ROAD_METERS, origin: ROAD.from, destination: ROAD.to, latest: halfway, departedAt: new Date(now.getTime() - 30 * 60_000), dueAt: null }).etaAt === null);
    const crow = movementProgress({ path: [], totalMeters: null, origin: ROAD.from, destination: ROAD.to, latest: halfway, departedAt: tenHoursAgo, dueAt: null });
    check("no road is a straight line, and says so", crow.approximate && near(crow.coveredMeters, ROAD_METERS / 2, ROAD_METERS * 0.01), crow);
    check("a date is due at the end of its day", dueBy(new Date("2026-10-01T22:00:00Z"))?.toISOString() === "2026-10-02T21:59:59.000Z");

    // 1. The truck leaves: the road already cached is kept, the one Google cannot draw never blocks
    const yesterday = new Date(now.getTime() - DAY);
    const late = await ownTruck({ lane: { from: origin, to: destination }, due: yesterday, phone: "+258840000981", description: "HARNESS progress late" });
    await cacheRoad(late.id, { from: origin, to: destination });
    await walkOut(late.id);
    const [kept] = await db.select().from(movementRoute).where(eq(movementRoute.movementId, late.id));
    check("a road already cached is not bought again when the truck leaves", kept?.computedAt.toISOString() === "2026-09-01T00:00:00.000Z", kept?.computedAt);

    const undrawn = await ownTruck({ lane: { from: origin, to: elsewhere }, due: new Date(now.getTime() + 3 * DAY), phone: "+258840000982", description: "HARNESS progress undrawn" });
    await walkOut(undrawn.id);
    const undrawnLoad = await loads(B.user).get({ id: undrawn.id });
    check("a lane Google cannot draw never blocks the dispatch", undrawnLoad.status === "on-route", undrawnLoad.status);
    check("…and caches nothing", (await db.select().from(movementRoute).where(eq(movementRoute.movementId, undrawn.id))).length === 0);

    // 2. The trail and the map read the progress
    const slot: SlotInfo = { slotDate: "2026-09-29", slot: "morning", minutesIntoSlot: 95 };
    const left = new Date(slotStart(slot).getTime() - 10 * HOUR);
    await departedAt(late.id, left);
    await ping(late.id, ROAD.from, new Date(left.getTime() + 5 * 60_000));
    await ping(late.id, MIDWAY, now);

    const trail = await loads(B.user).trail({ id: late.id });
    check("the trail carries the progress", trail.points.length === 2 && trail.progress !== null, trail.progress);
    check("halfway, with an eta, behind its date",
        trail.progress !== null && near(trail.progress.coveredMeters, ROAD_METERS / 2, ROAD_METERS * 0.02) && trail.progress.etaAt !== null && trail.progress.behind,
        trail.progress);
    check("the client reads the same", (await loads(A.user).trail({ id: late.id })).progress?.behind === true);
    check("a load without a road has no progress", (await loads(B.user).trail({ id: undrawn.id })).progress === null);

    const pin = (await map(B.user).overview()).find((entity) => entity.id === late.id);
    check("the map pin carries the kilometres to go", pin?.progress !== null && pin?.progress !== undefined && near(pin.progress.remainingKm, ROAD_METERS / 2000, 3) && pin.progress.behind, pin?.progress);

    // 3. The round's review: behind is an alert, and the client hears at once
    const onTime = await ownTruck({ lane: { from: origin, to: destination }, due: new Date("2027-01-01T00:00:00Z"), phone: "+258840000983", description: "HARNESS progress on time" });
    await cacheRoad(onTime.id, { from: origin, to: destination });
    await walkOut(onTime.id);
    await departedAt(onTime.id, left);
    await ping(onTime.id, ROAD.from, new Date(left.getTime() + 5 * 60_000));
    await ping(onTime.id, MIDWAY, new Date(slotStart(slot).getTime() + 30 * 60_000));

    await asked(slot, late.id);
    await asked(slot, onTime.id);
    const run = await reviewMovementSlot(db, slot);
    const alert = await alertOn(slot, late.id);
    check("a truck arriving after its date is filed as falling behind", alert?.issue === "falling-behind" && alert.streak === 1, { run, alert });
    check("the transporter's owner is told", (await toldAt(B.org, late.id)).length > 0);
    check("the client is told on the first round", (await toldAt(A.org, late.id)).length > 0);
    check("a truck on time is left alone", run.reviewed === 2 && run.alerts === 1 && (await alertOn(slot, onTime.id)) === undefined, { run, onTime: await alertOn(slot, onTime.id) });
}

async function cleanup() {
    if (movementsHere.length === 0) return;
    await db.delete(notification).where(and(eq(notification.entityType, "movement"), inArray(notification.entityId, movementsHere)));
    await db.delete(subscriptionUsage).where(and(eq(subscriptionUsage.entityType, "movement"), inArray(subscriptionUsage.entityId, movementsHere)));
    for (const table of [movementEvent, movementCost, movementDocument, movementRequest, movementLocation, movementTrackingAlert, movementTrackingRequest, movementRoute]) {
        await db.delete(table).where(inArray(table.movementId, movementsHere));
    }
    await db.update(movement).set({ executionMovementId: null }).where(inArray(movement.id, movementsHere));
    await db.delete(movement).where(inArray(movement.id, movementsHere));
    await db.delete(activityLog).where(eq(activityLog.sessionId, SESSION_ID));
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
