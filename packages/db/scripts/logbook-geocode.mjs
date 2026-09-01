/**
 * Builds the geocode + road-distance cache the dev logbook sync needs.
 *
 * Reads the ORDERS tab of the DEV DATABASE LOGBOOK, collects every distinct
 * loading/offloading address, resolves each through the Google Geocoding API
 * into the Location shape the order table stores ({ address, placeId,
 * country, state }), then measures the driving distance of every distinct
 * origin-destination pair through the Distance Matrix API.
 *
 * The cache is written next to this script and is additive: re-running only
 * fetches what is missing, so a partial run can be resumed and a failed
 * lookup retried without paying for the rest again.
 *
 * Usage:
 *   node packages/db/scripts/logbook-geocode.mjs [--retry-failed]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv, googleAccessToken, getValues } from "./google-sheets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, "logbook-geocode-cache.json");

const RETRY_FAILED = process.argv.includes("--retry-failed");

const env = loadEnv();
const key = env.GOOGLE_MAPS_API_KEY;
if (!key) throw new Error("GOOGLE_MAPS_API_KEY missing from apps/admin/.env");

const norm = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const cacheKey = (value) => norm(value).toLowerCase();

const cache = fs.existsSync(CACHE_PATH)
    ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"))
    : { addresses: {}, distances: {} };

const save = () => fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));

/** Google occasionally answers OVER_QUERY_LIMIT under a burst; back off and retry. */
async function withRetry(fn, label, attempts = 4) {
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
];

// South African provinces and the busiest border towns show up without ever
// naming the country, so they are treated as an explicit ZA hint
const ZA_HINTS = /\b(gauteng|mpumalanga|limpopo|free\s*state|kwazulu|natal|north\s*west|western\s*cape|eastern\s*cape|northern\s*cape|johannesburg|pretoria|midrand|sandton|nelspruit|durban|isando|meyerton|roodepla|magaliesburg|middelburg|middleburg|bapsfontein|rayton|harrismith|tzaneen|delmas|reitz|douglas|bethlehem|mooiriver|marble\s*hall|white\s*river|whiteriver|alzu|viljoenskroon|richards\s*bay|cape\s*town)\b/i;

// Spellings Google does not resolve on its own
const ALIASES = [
    [/^jo[ae]nn?esburgo$/i, "Johannesburg, South Africa"],
    [/^port elisabeth$/i, "Gqeberha, South Africa"],
];

function countryCandidates(raw) {
    for (const [pattern, code] of COUNTRY_NAMES) if (pattern.test(raw)) return [code];
    if (ZA_HINTS.test(raw)) return ["ZA", "MZ"];
    // Mozambique first: the logbook is a Mozambican order book
    return ["MZ", "ZA", "ZW", "ZM", "MW", "TZ", "SZ"];
}

async function geocodeIn(raw, country) {
    return withRetry(async () => {
        const url =
            `https://maps.googleapis.com/maps/api/geocode/json` +
            `?address=${encodeURIComponent(raw)}&components=country:${country}&region=${country.toLowerCase()}&key=${key}`;
        return (await fetch(url)).json();
    }, `${raw} [${country}]`);
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
    };
};

/**
 * A country-filtered query always "succeeds": when the place is not in that
 * country Google answers with the country itself. Accepting that is how
 * Lusaka became Mozambique — so a country-level hit is never a match, only
 * a last-resort fallback once every candidate and every trimmed form of the
 * address has been tried.
 */
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

/**
 * Provinces are polygons, not places: routing to one always comes back
 * ZERO_RESULTS, so the capital stands in for the province as a whole.
 */
const PROVINCE_SEAT = {
    "maputo province": "Maputo, Mozambique",
    "maputo city": "Maputo, Mozambique",
    "gaza province": "Xai-Xai, Gaza, Mozambique",
    "inhambane province": "Inhambane, Mozambique",
    "sofala province": "Beira, Sofala, Mozambique",
    "manica province": "Chimoio, Manica, Mozambique",
    "tete province": "Tete, Mozambique",
    "zambezia province": "Quelimane, Zambezia, Mozambique",
    "nampula province": "Nampula, Mozambique",
    "niassa province": "Lichinga, Niassa, Mozambique",
    "cabo delgado province": "Pemba, Cabo Delgado, Mozambique",
    "mozambique": "Maputo, Mozambique",
};

const routable = (address) => PROVINCE_SEAT[address.replace(/,\s*Mozambique$/i, "").toLowerCase()]
    ?? PROVINCE_SEAT[address.toLowerCase()]
    ?? address;

const EARTH_KM = 6371;
const radians = (deg) => (deg * Math.PI) / 180;

/** Great-circle km — the last-resort estimate when no route can be found. */
function haversine(a, b) {
    const dLat = radians(b.lat - a.lat);
    const dLng = radians(b.lng - a.lng);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

async function measure(origin, destination) {
    const data = await withRetry(async () => {
        const url =
            `https://maps.googleapis.com/maps/api/distancematrix/json` +
            `?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}` +
            `&mode=driving&units=metric&region=mz&key=${key}`;
        return (await fetch(url)).json();
    }, `${origin} -> ${destination}`);

    const element = data.rows?.[0]?.elements?.[0];
    if (data.status !== "OK" || element?.status !== "OK") {
        return { ok: false, status: element?.status ?? data.status, error: data.error_message ?? null };
    }

    return {
        ok: true,
        km: Math.round(element.distance.value / 1000),
        hours: Math.round((element.duration.value / 3600) * 10) / 10,
    };
}

async function drivingDistance(origin, destination, geometry) {
    const direct = await measure(routable(origin), routable(destination));
    if (direct.ok) return { ...direct, source: "distance-matrix" };

    // No drivable route in Google's Mozambique graph (a handful of
    // up-country pairs). 1.3 is the usual road-to-crow-flight ratio on the
    // measured pairs, so the estimate lands in the right band.
    const [a, b] = geometry;
    if (a && b) {
        return { ok: true, km: Math.round(haversine(a, b) * 1.3), hours: null, source: "great-circle-estimate" };
    }

    return direct;
}

/**
 * Sheet
 */
const token = await googleAccessToken(env);
const spreadsheetId = env.GOOGLE_SHEETS_ORDERS_SPREADSHEET_ID;
const values = await getValues(token, spreadsheetId, "ORDERS", "A1:DZ2000", "?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING");
const rows = values.slice(2).filter((row) => norm(row.slice(0, 60).join("")) !== "");

console.log(`${rows.length} order rows in ${spreadsheetId}`);

const addresses = new Map(); // cacheKey -> raw (first spelling wins)
for (const row of rows) {
    for (const raw of [norm(row[2]), norm(row[3])]) {
        if (raw && !addresses.has(cacheKey(raw))) addresses.set(cacheKey(raw), raw);
    }
}
console.log(`${addresses.size} distinct addresses`);

/**
 * Geocode pass
 */
let geocoded = 0;
let failed = 0;
for (const [k, raw] of addresses) {
    const cached = cache.addresses[k];
    // A hit without coordinates predates the geometry capture and is refreshed
    if (cached?.ok && cached.lat != null) continue;
    if (cached && !cached.ok && !RETRY_FAILED) continue;

    const result = await geocode(raw);
    cache.addresses[k] = result;
    if (result.ok) geocoded++;
    else {
        failed++;
        console.warn(`  geocode ${result.status}: ${raw}`);
    }
    if ((geocoded + failed) % 25 === 0) {
        save();
        console.log(`  ...${geocoded + failed} looked up`);
    }
}
save();
console.log(`geocoded ${geocoded} new, ${failed} failed, ${Object.keys(cache.addresses).length} cached total`);

/**
 * Distance pass, keyed on the resolved (canonical) address pair so the many
 * spellings of the same place collapse onto one lookup
 */
const entryOf = (raw) => {
    const entry = cache.addresses[cacheKey(raw)];
    return entry?.ok ? entry : null;
};
const canonical = (raw) => entryOf(raw)?.location.address ?? null;
const point = (raw) => {
    const entry = entryOf(raw);
    return entry?.lat != null && entry?.lng != null ? { lat: entry.lat, lng: entry.lng } : null;
};

const pairs = new Map(); // "origin|destination" -> [origin, destination, [pointA, pointB]]
for (const row of rows) {
    const origin = canonical(norm(row[2]));
    const destination = canonical(norm(row[3]));
    if (!origin || !destination || origin === destination) continue;
    pairs.set(`${origin}|${destination}`, [origin, destination, [point(norm(row[2])), point(norm(row[3]))]]);
}
console.log(`${pairs.size} distinct canonical origin-destination pairs`);

let measured = 0;
let unmeasured = 0;
for (const [k, [origin, destination, geometry]] of pairs) {
    const cached = cache.distances[k];
    if (cached && (cached.ok || !RETRY_FAILED)) continue;

    const result = await drivingDistance(origin, destination, geometry);
    cache.distances[k] = result;
    if (result.ok) measured++;
    else {
        unmeasured++;
        console.warn(`  distance ${result.status}: ${origin} -> ${destination}`);
    }
    if ((measured + unmeasured) % 25 === 0) {
        save();
        console.log(`  ...${measured + unmeasured} measured`);
    }
}
save();

console.log(`measured ${measured} new, ${unmeasured} unreachable, ${Object.keys(cache.distances).length} cached total`);
console.log(`cache written to ${CACHE_PATH}`);
