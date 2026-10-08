import { cumulativeDistances, decodePolyline, haversineMeters, projectOntoPath } from "@workspace/maps/lib/geometry";
import type { LatLng } from "@workspace/maps/types";

/**
 * How far along its road a truck is, and when it will arrive at the pace it
 * has kept — read off the cached route and the latest position, nothing
 * stored. Pure: the callers (the trail, the map, the slot review) fetch the
 * rows and hand them in, so the arithmetic is checked on its own below.
 */

/** Beyond this far from the planned route's line, a truck on route has left it. */
export const OFF_ROUTE_METERS = 10_000;

/** Under this much ground covered since the last position, a truck on route did not move. */
export const SHORT_DISTANCE_METERS = 20_000;

/** No ETA before the truck has covered this much: the first ping's speed is noise. */
export const MIN_ETA_METERS = SHORT_DISTANCE_METERS;

/** …nor before it has been on the road this long. */
export const MIN_ETA_HOURS = 1;

/**
 * The stages a truck is still on its way in, order and load vocabulary
 * alike: from leaving the loading site to reaching the offloading one. At
 * the offloading site the road is behind it, and an ETA would be noise.
 */
export const EN_ROUTE_STATUSES: readonly string[] = ["on-route", "stopped", "issue", "at-border"];

const HOUR_MS = 3_600_000;

/** The route columns the arithmetic needs, as `movement_route` and `order_route` both store them. */
export type RouteLike = {
    originLat: number;
    originLng: number;
    destinationLat: number;
    destinationLng: number;
    encodedPolyline: string | null;
    distanceMeters: number | null;
};

export type LatestPing = { lat: number; lng: number; recordedAt: Date };

export type MovementProgress = {
    coveredMeters: number;
    remainingMeters: number;
    totalMeters: number;
    /** Null until the truck has been on the road long enough to have a pace */
    avgKmh: number | null;
    etaAt: Date | null;
    /** The ETA falls after the agreed delivery time */
    behind: boolean;
    /** Straight-line arithmetic: no road is known, or the truck is off it */
    approximate: boolean;
    /** When the position this was read from was recorded */
    at: Date;
};

/**
 * Where the truck stands on the road and when it arrives at its average pace.
 * `departedAt` is when it left the loading site (the move to on-route); the
 * clock runs from there to the latest ping. Off the road, or without one,
 * the distances are as the crow flies and say so.
 */
export function movementProgress(input: {
    path: LatLng[];
    totalMeters: number | null;
    origin: LatLng;
    destination: LatLng;
    latest: LatestPing;
    departedAt: Date | null;
    dueAt: Date | null;
}): MovementProgress {
    const { path, latest, origin, destination, departedAt, dueAt } = input;
    const cum = path.length >= 2 ? cumulativeDistances(path) : null;
    const projected = cum ? projectOntoPath(path, cum, latest) : null;
    const roadLength = cum ? cum[cum.length - 1] ?? 0 : 0;

    let totalMeters: number;
    let coveredMeters: number;
    let approximate: boolean;

    if (projected && projected.distance <= OFF_ROUTE_METERS && roadLength > 0) {
        totalMeters = input.totalMeters ?? roadLength;
        // The polyline's own length and Google's distance differ by a hair; the snap is on the polyline
        coveredMeters = Math.min(totalMeters, (projected.along / roadLength) * totalMeters);
        approximate = false;
    } else {
        totalMeters = input.totalMeters ?? haversineMeters(origin, destination);
        coveredMeters = Math.max(0, Math.min(totalMeters, totalMeters - haversineMeters(latest, destination)));
        approximate = true;
    }

    const remainingMeters = Math.max(0, totalMeters - coveredMeters);
    const elapsedHours = departedAt ? (latest.recordedAt.getTime() - departedAt.getTime()) / HOUR_MS : null;
    const avgKmh = elapsedHours !== null && elapsedHours >= MIN_ETA_HOURS && coveredMeters >= MIN_ETA_METERS
        ? Math.round((coveredMeters / 1000 / elapsedHours) * 10) / 10
        : null;
    const etaAt = avgKmh ? new Date(latest.recordedAt.getTime() + (remainingMeters / 1000 / avgKmh) * HOUR_MS) : null;

    return {
        coveredMeters: Math.round(coveredMeters),
        remainingMeters: Math.round(remainingMeters),
        totalMeters: Math.round(totalMeters),
        avgKmh,
        etaAt,
        behind: etaAt !== null && dueAt !== null && etaAt.getTime() > dueAt.getTime(),
        approximate,
        at: latest.recordedAt,
    };
}

/** The same, from a cached route row: the polyline is decoded here. */
export function progressFromRoute(route: RouteLike, latest: LatestPing, departedAt: Date | null, dueAt: Date | null): MovementProgress {
    return movementProgress({
        path: route.encodedPolyline ? decodePolyline(route.encodedPolyline) : [],
        totalMeters: route.distanceMeters,
        origin: { lat: route.originLat, lng: route.originLng },
        destination: { lat: route.destinationLat, lng: route.destinationLng },
        latest,
        departedAt,
        dueAt,
    });
}

const MAPUTO_OFFSET_MS = 2 * HOUR_MS;

/**
 * When a delivery is due. The form keeps a date, stored as that day's
 * midnight in Maputo, and a truck arriving at four in the afternoon of the
 * agreed day is on time — so a midnight stamp means the end of that day. A
 * stamp with a time of day is taken as it is.
 */
export function dueBy(expectedAt: Date | null): Date | null {
    if (!expectedAt) return null;
    const local = expectedAt.getTime() + MAPUTO_OFFSET_MS;
    const midnight = local % (24 * HOUR_MS) === 0;

    return midnight ? new Date(expectedAt.getTime() + 24 * HOUR_MS - 1000) : expectedAt;
}

// pnpm dlx tsx packages/domain/src/tracking/progress.ts — the arithmetic on its own
if (process.argv[1]?.endsWith("progress.ts")) {
    const eq = (name: string, got: unknown, want: unknown) => {
        if (got !== want) throw new Error(`${name}: got ${String(got)}, want ${String(want)}`);
    };
    const near = (name: string, got: number, want: number, tolerance: number) => {
        if (Math.abs(got - want) > tolerance) throw new Error(`${name}: got ${got}, want ${want} ± ${tolerance}`);
    };

    // A straight road (-15,39) → (-16,40), about 155 km; the truck halfway along it
    const origin = { lat: -15, lng: 39 };
    const destination = { lat: -16, lng: 40 };
    const path = [origin, destination];
    const total = haversineMeters(origin, destination);
    const now = new Date("2026-10-01T10:00:00Z");
    const halfway = { lat: -15.5, lng: 39.5, recordedAt: now };
    const tenHoursAgo = new Date(now.getTime() - 10 * HOUR_MS);

    const mid = movementProgress({ path, totalMeters: total, origin, destination, latest: halfway, departedAt: tenHoursAgo, dueAt: null });
    near("halfway covered", mid.coveredMeters, total / 2, total * 0.01);
    near("halfway remaining", mid.remainingMeters, total / 2, total * 0.01);
    eq("on the road", mid.approximate, false);
    near("pace", mid.avgKmh ?? 0, total / 2 / 1000 / 10, 0.2);
    near("eta at the same pace", mid.etaAt?.getTime() ?? 0, now.getTime() + 10 * HOUR_MS, 10 * 60_000);
    eq("not behind without a due date", mid.behind, false);

    const late = movementProgress({ path, totalMeters: total, origin, destination, latest: halfway, departedAt: tenHoursAgo, dueAt: new Date(now.getTime() + 5 * HOUR_MS) });
    eq("behind a due date the pace cannot make", late.behind, true);
    const fine = movementProgress({ path, totalMeters: total, origin, destination, latest: halfway, departedAt: tenHoursAgo, dueAt: new Date(now.getTime() + 15 * HOUR_MS) });
    eq("on time otherwise", fine.behind, false);

    const early = movementProgress({ path, totalMeters: total, origin, destination, latest: halfway, departedAt: new Date(now.getTime() - 30 * 60_000), dueAt: null });
    eq("no eta in the first hour", early.etaAt, null);
    const unknown = movementProgress({ path, totalMeters: total, origin, destination, latest: halfway, departedAt: null, dueAt: null });
    eq("no eta without a departure", unknown.etaAt, null);

    const crow = movementProgress({ path: [], totalMeters: null, origin, destination, latest: halfway, departedAt: tenHoursAgo, dueAt: null });
    eq("no road is approximate", crow.approximate, true);
    near("…and still halfway", crow.coveredMeters, total / 2, total * 0.01);

    const astray = movementProgress({ path, totalMeters: total, origin, destination, latest: { lat: -15.5, lng: 39.9, recordedAt: now }, departedAt: tenHoursAgo, dueAt: null });
    eq("off the road is approximate", astray.approximate, true);

    eq("a midnight stamp is due at the end of its day", dueBy(new Date("2026-10-01T22:00:00Z"))?.toISOString(), "2026-10-02T21:59:59.000Z");
    eq("a timed stamp is due then", dueBy(new Date("2026-10-02T14:30:00Z"))?.toISOString(), "2026-10-02T14:30:00.000Z");
    eq("no stamp, no due", dueBy(null), null);
    console.log("ok");
}
