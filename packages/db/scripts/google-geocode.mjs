/**
 * Google Geocoding for the logbook scripts.
 *
 * Resolves the free-text places the logbook records ("Nacala", "Moz Agri,
 * Catandica, Chimoio", "Mozambique, Pemba, Cabo Delgado, Av. Chai, ...")
 * into the Location shape the database stores ({ address, placeId,
 * country, state }). Shared by the orders geocode pass and the party sync;
 * each keeps its own cache.
 */

/** Google occasionally answers OVER_QUERY_LIMIT under a burst; back off and retry. */
export async function withRetry(fn, label, attempts = 4) {
    for (let attempt = 1; ; attempt++) {
        try {
            const result = await fn();
            if (result.status !== "OVER_QUERY_LIMIT" && result.status !== "UNKNOWN_ERROR") return result;
            if (attempt >= attempts) return result;
        } catch (error) {
            if (attempt >= attempts) throw error;
            console.warn(`  retry ${attempt} ${label}: ${error.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
}

/**
 * Country constraint. Region biasing alone is not enough: bare Mozambican
 * place names collide with far-away homonyms ("Temane" resolves to Nepal,
 * "Rapale" to France), so every lookup is filtered to a country and only
 * falls through to the next candidate on ZERO_RESULTS.
 */
const COUNTRY_NAMES = [
    [/\b(mo(ç|c)ambique|mozambique)\b/i, "MZ"],
    [/\b(south\s*africa|(á|a)frica\s*do\s*sul|\bRSA\b)\b/i, "ZA"],
    [/\b(zimbabwe|zimbabu(é|e))\b/i, "ZW"],
    [/\bzambia\b/i, "ZM"],
    [/\bmalawi\b/i, "MW"],
    [/\btan(z|s)ania\b/i, "TZ"],
    [/\b(eswatini|swaziland)\b/i, "SZ"],
    [/\bbotswana\b/i, "BW"],
    [/\bkenya\b/i, "KE"],
    [/\bnigeria\b/i, "NG"],
    [/\bethiopia\b/i, "ET"],
    [/\bindia\b/i, "IN"],
    [/\bestonia\b/i, "EE"],
];

// South African provinces and the busiest border towns show up without ever
// naming the country, so they are treated as an explicit ZA hint
const ZA_HINTS = /\b(gauteng|mpumalanga|limpopo|free\s*state|kwazulu|natal|north\s*west|western\s*cape|eastern\s*cape|northern\s*cape|johannesburg|pretoria|midrand|sandton|nelspruit|durban|isando|meyerton|roodepla|magaliesburg|middelburg|middleburg|bapsfontein|rayton|harrismith|tzaneen|delmas|reitz|douglas|bethlehem|mooiriver|marble\s*hall|white\s*river|whiteriver|alzu|viljoenskroon|richards\s*bay|cape\s*town)\b/i;

// Spellings Google does not resolve on its own
const ALIASES = [
    [/^jo[ae]nn?esburgo$/i, "Johannesburg, South Africa"],
    [/^port elisabeth$/i, "Gqeberha, South Africa"],
];

export function countryCandidates(raw) {
    for (const [pattern, code] of COUNTRY_NAMES) if (pattern.test(raw)) return [code];
    if (ZA_HINTS.test(raw)) return ["ZA", "MZ"];
    // Mozambique first: the logbook is a Mozambican order book
    return ["MZ", "ZA", "ZW", "ZM", "MW", "TZ", "SZ"];
}

const toEntry = (result, country) => {
    const component = (type) => result.address_components?.find((c) => c.types?.includes(type))?.long_name ?? "";

    return {
        ok: true,
        country,
        // Kept outside `location` (which is stored verbatim on the order
        // row) — only the distance fallback needs the coordinates
        lat: result.geometry?.location?.lat ?? null,
        lng: result.geometry?.location?.lng ?? null,
        // A province polygon has no routable point; the distance pass
        // swaps in the capital instead of failing the pair
        isArea: result.types?.some((t) => t === "administrative_area_level_1" || t === "country") ?? false,
        location: {
            address: result.formatted_address ?? "",
            placeId: result.place_id ?? "",
            country: component("country"),
            // MZ geocodes carry the province as admin level 1; plus-code
            // results only resolve down to a locality
            state: component("administrative_area_level_1") || component("locality") || "",
        },
        // The individual levels, for callers that want a town rather than
        // a province as the label
        components: {
            country: component("country"),
            admin1: component("administrative_area_level_1"),
            admin2: component("administrative_area_level_2"),
            locality: component("locality"),
        },
    };
};

/**
 * Builds a geocoder bound to one API key.
 *
 * A country-filtered query always "succeeds": when the place is not in that
 * country Google answers with the country itself. Accepting that is how
 * Lusaka became Mozambique — so a country-level hit is never a match, only
 * a last-resort fallback once every candidate and every trimmed form of the
 * address has been tried. Such fallbacks come back flagged `weak: true`.
 */
export function createGeocoder(key) {
    if (!key) throw new Error("GOOGLE_MAPS_API_KEY missing");

    async function geocodeIn(raw, country) {
        return withRetry(async () => {
            const url =
                `https://maps.googleapis.com/maps/api/geocode/json` +
                `?address=${encodeURIComponent(raw)}&components=country:${country}&region=${country.toLowerCase()}&key=${key}`;
            return (await fetch(url)).json();
        }, `${raw} [${country}]`);
    }

    async function geocode(raw) {
        const aliased = ALIASES.find(([pattern]) => pattern.test(raw));
        const base = aliased ? aliased[1] : raw;

        // "Business Name, Town, Province" where the business is unknown to Google
        // still resolves once the leading segment is dropped
        const segments = base.split(",").map((s) => s.trim()).filter(Boolean);
        const forms = [base, ...segments.slice(1).map((_, i) => segments.slice(i + 1).join(", "))]
            .filter((form, index, all) => form && all.indexOf(form) === index);

        let weak = null;
        let last = { status: "ZERO_RESULTS" };

        for (const form of forms) {
            for (const country of countryCandidates(base)) {
                const data = await geocodeIn(form, country);
                last = data;
                const result = data.status === "OK" ? data.results?.[0] : null;
                if (!result) continue;

                const entry = toEntry(result, country);
                // Nothing more specific than the country came back. Google
                // dresses these up in different clothes — sometimes types
                // ["country"], sometimes a partial-match establishment whose
                // formatted address is still just "South Africa" — but they all
                // share a one-part address, which a real place never has.
                if (result.types?.includes("country") || !entry.location.address.includes(",")) {
                    weak ??= entry;
                    continue;
                }
                return entry;
            }
        }

        if (weak) return { ...weak, weak: true };
        return { ok: false, status: last.status, error: last.error_message ?? null, raw };
    }

    return { geocode };
}
