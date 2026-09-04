import "server-only";

import type { Location } from "@workspace/db/orders";

import type { LatLng, RouteSource } from "@/frontend/pages/map/types";

/**
 * Origin/destination geometry for one order, resolved against Google.
 *
 * Two tiers, in order: the Routes API gives a drivable road polyline with
 * distance and duration; when it refuses (bad place id, quota, network) we
 * fall back to geocoding the two endpoints so the map can still draw a
 * straight chord. Deliberately dependency-free — plain `fetch`, no SDK —
 * because this runs inside a tRPC query on a serverless cold start.
 */
export type ComputedRoute = {
    origin: LatLng;
    destination: LatLng;
    encodedPolyline: string | null;
    distanceMeters: number | null;
    durationSeconds: number | null;
    source: RouteSource;
};

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

// Only the fields we read; a wider mask costs a higher billing SKU
const FIELD_MASK = "routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration,routes.legs.startLocation,routes.legs.endLocation";

// The caller is a user-facing query, so a hung Google call must not hold the
// request open longer than the client is willing to wait
const TIMEOUT_MS = 8_000;

// Module scope: one warning per cold start instead of one per order opened
let missingKeyLogged = false;

type GoogleLatLng = { latitude?: number; longitude?: number };

type RoutesLeg = {
    startLocation?: { latLng?: GoogleLatLng };
    endLocation?: { latLng?: GoogleLatLng };
};

type RoutesResponse = {
    routes?: {
        polyline?: { encodedPolyline?: string };
        distanceMeters?: number;
        duration?: string;
        legs?: RoutesLeg[];
    }[];
    error?: { code?: number; status?: string; message?: string };
};

type GeocodeResponse = {
    status?: string;
    error_message?: string;
    results?: { geometry?: { location?: { lat?: number; lng?: number } } }[];
};

function reason(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`;

    return String(error);
}

/**
 * The key is read per call rather than captured at module load so a
 * redeployed env var takes effect without a rebuild. Never logged.
 */
function apiKey(): string | null {
    const key = process.env.GOOGLE_MAPS_API_KEY;

    if (!key) {
        if (!missingKeyLogged) {
            missingKeyLogged = true;
            console.warn("[maps] GOOGLE_MAPS_API_KEY is unset — routes and geocoding are disabled");
        }

        return null;
    }

    return key;
}

type Waypoint = { placeId: string } | { address: string };

/**
 * A place id pins the exact spot Ops picked in the autocomplete; the typed
 * address is the fallback for legacy rows saved before place ids were kept.
 */
function waypoint(location: Location): Waypoint {
    return location.placeId ? { placeId: location.placeId } : { address: location.address };
}

/**
 * Routes refuses area-sized endpoints: a load booked to "Nampula Province"
 * (a real logbook pattern) gets an empty response for the place id, the
 * address text and even the province centroid, which sits off-road. Most
 * Mozambican provinces carry the name of their capital, so "<state>, <country>"
 * with the "Province" suffix stripped usually lands on the city and routes.
 * Returns null when there is nothing different to try.
 */
function regionWaypoint(location: Location): Waypoint | null {
    const city = location.state?.replace(/\s*\(?(province|prov[ií]ncia)\)?\s*$/iu, "").trim();

    if (!city || !location.country) return null;

    const address = `${city}, ${location.country}`;

    return address.toLowerCase() === location.address.trim().toLowerCase() ? null : { address };
}

function toLatLng(raw: GoogleLatLng | undefined): LatLng | null {
    if (!raw || typeof raw.latitude !== "number" || typeof raw.longitude !== "number") return null;

    return { lat: raw.latitude, lng: raw.longitude };
}

/** Routes returns durations as protobuf strings, e.g. "58412s". */
function parseDuration(raw: string | undefined): number | null {
    if (!raw) return null;

    const seconds = Number.parseInt(raw, 10);

    return Number.isFinite(seconds) ? seconds : null;
}

/** Step 1 — the real road route. Returns null on any failure, having logged it. */
async function computeViaRoutes(key: string, origin: Waypoint, destination: Waypoint): Promise<ComputedRoute | null> {
    let payload: RoutesResponse | null = null;

    try {
        const response = await fetch(ROUTES_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": key,
                "X-Goog-FieldMask": FIELD_MASK,
            },
            body: JSON.stringify({
                origin,
                destination,
                travelMode: "DRIVE",
                // Live traffic would change the answer between two cache
                // reads and costs the Preferred SKU; the map only needs shape
                routingPreference: "TRAFFIC_UNAWARE",
                polylineQuality: "OVERVIEW",
                polylineEncoding: "ENCODED_POLYLINE",
                computeAlternativeRoutes: false,
                units: "METRIC",
                languageCode: "pt",
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        payload = (await response.json().catch(() => null)) as RoutesResponse | null;

        if (!response.ok) {
            // An invalid/stale place id lands here as 400 INVALID_ARGUMENT
            console.warn(`[maps] computeRoutes ${response.status}: ${payload?.error?.message ?? payload?.error?.status ?? "no error body"}`);

            return null;
        }
    } catch (error) {
        console.warn(`[maps] computeRoutes request failed: ${reason(error)}`);

        return null;
    }

    const route = payload?.routes?.[0];

    if (!route) {
        console.warn("[maps] computeRoutes returned no routes for this pair");

        return null;
    }

    const legs = route.legs ?? [];
    const start = toLatLng(legs[0]?.startLocation?.latLng);
    const end = toLatLng(legs[legs.length - 1]?.endLocation?.latLng);

    if (!start || !end) {
        console.warn("[maps] computeRoutes returned a route without leg endpoints");

        return null;
    }

    return {
        origin: start,
        destination: end,
        encodedPolyline: route.polyline?.encodedPolyline ?? null,
        distanceMeters: typeof route.distanceMeters === "number" ? route.distanceMeters : null,
        durationSeconds: parseDuration(route.duration),
        source: "routes",
    };
}

/**
 * Step 2 — endpoints only. Tries the place id first, then the free-text
 * address, so a place id that Routes rejected can still resolve by name.
 */
async function geocode(key: string, location: Location): Promise<LatLng | null> {
    const attempts: string[] = [];

    if (location.placeId) attempts.push(`place_id=${encodeURIComponent(location.placeId)}`);
    if (location.address) attempts.push(`address=${encodeURIComponent(location.address)}`);

    for (const query of attempts) {
        try {
            // The key rides in the query string — never log this URL
            const response = await fetch(`${GEOCODE_URL}?${query}&key=${encodeURIComponent(key)}`, {
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });

            const payload = (await response.json().catch(() => null)) as GeocodeResponse | null;

            if (!response.ok || payload?.status !== "OK") {
                console.warn(`[maps] geocode ${response.status} ${payload?.status ?? "no status"}: ${payload?.error_message ?? "no error message"}`);

                continue;
            }

            const point = payload.results?.[0]?.geometry?.location;

            if (typeof point?.lat === "number" && typeof point.lng === "number") {
                return { lat: point.lat, lng: point.lng };
            }

            console.warn("[maps] geocode returned no usable result");
        } catch (error) {
            console.warn(`[maps] geocode request failed: ${reason(error)}`);
        }
    }

    return null;
}

/**
 * Resolve one order's route. `null` means Google gave us nothing usable —
 * the caller decides whether to serve a stale cached row or fail the query.
 */
export async function computeOrderRoute(origin: Location, destination: Location): Promise<ComputedRoute | null> {
    const key = apiKey();

    if (!key) return null;

    const road = await computeViaRoutes(key, waypoint(origin), waypoint(destination));

    if (road) return road;

    // Second try with province-sized endpoints narrowed to their capital
    const originRegion = regionWaypoint(origin);
    const destinationRegion = regionWaypoint(destination);

    if (originRegion || destinationRegion) {
        const regional = await computeViaRoutes(key, originRegion ?? waypoint(origin), destinationRegion ?? waypoint(destination));

        if (regional) return regional;
    }

    const [originPoint, destinationPoint] = await Promise.all([
        geocode(key, origin),
        geocode(key, destination),
    ]);

    if (!originPoint || !destinationPoint) {
        console.warn("[maps] geocode fallback could not resolve both endpoints");

        return null;
    }

    return {
        origin: originPoint,
        destination: destinationPoint,
        encodedPolyline: null,
        distanceMeters: null,
        durationSeconds: null,
        source: "geocode",
    };
}
