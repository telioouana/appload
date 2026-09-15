import "server-only";

/**
 * The place a driver's ping is in, as text: "District or city, Province,
 * Country", resolved once against Google and stored on the ping. Same shape
 * as routes.ts — plain `fetch`, no SDK — because it runs inside the Infobip
 * webhook and inside a tRPC query, both on serverless cold starts.
 */

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

// Only the administrative levels the label is built from: the response is
// smaller, and Google never spends a result on a street address
const RESULT_TYPES = "locality|administrative_area_level_2|administrative_area_level_1|country";

// Shorter than the route timeout: a label is decoration, and the webhook
// holds Infobip's request open while it waits
const TIMEOUT_MS = 5_000;

// Module scope: one warning per cold start instead of one per ping
let missingKeyLogged = false;

type AddressComponent = { long_name?: string; types?: string[] };

type GeocodeResponse = {
    status?: string;
    error_message?: string;
    results?: { address_components?: AddressComponent[] }[];
};

/**
 * The key is read per call rather than captured at module load so a
 * redeployed env var takes effect without a rebuild. Never logged.
 */
function apiKey(): string | null {
    const key = process.env.GOOGLE_MAPS_API_KEY;

    if (!key) {
        if (!missingKeyLogged) {
            missingKeyLogged = true;
            console.warn("[maps] GOOGLE_MAPS_API_KEY is unset — reverse geocoding is disabled");
        }

        return null;
    }

    return key;
}

/**
 * Picks one name per level across every result, coarsest result last so the
 * first result's (most specific) component wins. Mozambican districts come
 * back as administrative_area_level_2 and their towns as locality, so the
 * first slot takes whichever is present.
 */
function buildLabel(results: GeocodeResponse["results"]): string | null {
    const components = (results ?? []).flatMap((result) => result.address_components ?? []);

    const pick = (...types: string[]): string | null => {
        for (const type of types) {
            const found = components.find((component) => component.types?.includes(type) && component.long_name);

            if (found?.long_name) return found.long_name;
        }

        return null;
    };

    const parts = [
        pick("locality", "administrative_area_level_2", "sublocality"),
        pick("administrative_area_level_1"),
        pick("country"),
    ].filter((part): part is string => part !== null);

    // "Maputo, Maputo, Mozambique" reads as a stutter: keep each name once
    const label = [...new Set(parts)].join(", ");

    return label || null;
}

/**
 * The label for one coordinate pair, or null when Google has nothing usable
 * (ZERO_RESULTS, a refused key, a timeout, no key at all). Never throws: a
 * ping without a label is still a ping, and the callers store it either way.
 */
export async function reverseGeocode({ latitude, longitude }: { latitude: number; longitude: number }): Promise<string | null> {
    const key = apiKey();

    if (!key) return null;

    const query = `latlng=${latitude},${longitude}&result_type=${RESULT_TYPES}&language=pt`;

    try {
        // The key rides in the query string — never log this URL
        const response = await fetch(`${GEOCODE_URL}?${query}&key=${encodeURIComponent(key)}`, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        const payload = (await response.json().catch(() => null)) as GeocodeResponse | null;

        if (!response.ok || payload?.status !== "OK") {
            // Open sea and the odd border strip come back ZERO_RESULTS: not
            // worth a warning, the coordinates stand in for the label
            if (payload?.status !== "ZERO_RESULTS") {
                console.warn(`[maps] reverse geocode ${response.status} ${payload?.status ?? "no status"}: ${payload?.error_message ?? "no error message"}`);
            }

            return null;
        }

        return buildLabel(payload.results);
    } catch (error) {
        console.warn(`[maps] reverse geocode request failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);

        return null;
    }
}
