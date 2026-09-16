/**
 * Rebuilds the development database from the DEV DATABASE LOGBOOK.
 *
 * Wipes every operational table (orders and everything hanging off them,
 * organizations, fleet, drivers) and rebuilds them from the logbook's ORDERS
 * tab. User accounts and sessions are left alone so people can still sign in.
 *
 * The logbook is a hand-kept spreadsheet: roughly half its rows never got an
 * Order Id, and columns the app now requires (cargo category, load type, POD
 * status, distance, geocoded addresses) were rarely filled. The sync fills
 * them — measured, derived, or defaulted, in that order of preference — and
 * the report at the end says which, so nothing derived is mistaken for
 * something recorded.
 *
 * Nothing is written back to the spreadsheet.
 *
 * Requires the geocode cache:
 *   node packages/db/scripts/logbook-geocode.mjs
 *
 * Usage:
 *   node packages/db/scripts/sync-dev-from-logbook.mjs [--dry] [--yes]
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";

import { loadEnv, googleAccessToken, getValues, sheetsGet } from "./google-sheets.mjs";
import * as map from "./logbook-mapping.mjs";
import { seedAppload } from "./seed-appload-organization.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, "logbook-geocode-cache.json");

const DRY = process.argv.includes("--dry");
const ASSUME_YES = process.argv.includes("--yes");

const env = loadEnv();
const sql = neon(env.DATABASE_URL);
const q = (statement, params = []) => sql.query(statement, params);

const norm = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const key = (value) => norm(value).toLowerCase();
const plate = (value) => norm(value).toUpperCase();

const slugify = (value) =>
    key(value).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";

/**
 * Safety rails. This script truncates; it must never be pointed at
 * production by a stale shell variable.
 */
const databaseName = decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1)).split("?")[0];
if (!/dev/i.test(databaseName)) {
    throw new Error(`refusing to run: DATABASE_URL names "${databaseName}", which is not a dev database`);
}

const spreadsheetId = env.GOOGLE_SHEETS_ORDERS_SPREADSHEET_ID;
const token = await googleAccessToken(env);
const meta = await sheetsGet(token, spreadsheetId, "?fields=properties.title");
const spreadsheetTitle = meta.properties.title;
if (!/^dev\b/i.test(spreadsheetTitle)) {
    throw new Error(`refusing to run: spreadsheet "${spreadsheetTitle}" is not the DEV logbook`);
}

console.log(`database:    ${databaseName}`);
console.log(`spreadsheet: ${spreadsheetTitle} (${spreadsheetId})`);
console.log(DRY ? "mode:        DRY RUN — nothing is written\n" : "mode:        WRITE\n");

/**
 * Sheet
 */
const values = await getValues(
    token,
    spreadsheetId,
    "ORDERS",
    "A1:DZ5000",
    "?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING",
);

const columns = map.resolveColumns(values[map.HEADER_ROW - 1] ?? []);
const cell = map.reader(columns);
const REQUIRED_HEADERS = ["Order Id", "Shipper", "Loading Address", "Offloading Address", "Status", "Deal Date", "Carrier"];
const missingHeaders = REQUIRED_HEADERS.filter((header) => !map.hasColumn(columns, header));
if (missingHeaders.length) throw new Error(`ORDERS sheet is missing columns: ${missingHeaders.join(", ")}`);

// A row counts as an order once anything before the accounting block is set
const rows = values.slice(map.HEADER_ROW).filter((row) => norm(row.slice(0, 60).join("")) !== "");
console.log(`${rows.length} order rows read from ORDERS`);

/**
 * Geocode + distance cache
 */
if (!fs.existsSync(CACHE_PATH)) {
    throw new Error("geocode cache missing — run: node packages/db/scripts/logbook-geocode.mjs");
}
const cache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));

const UNKNOWN_LOCATION = { address: "Unknown", placeId: "", country: "", state: "" };

const located = (raw) => {
    const entry = cache.addresses[key(raw)];
    if (entry?.ok) return entry.location;
    const trimmed = norm(raw);
    return trimmed ? { address: trimmed, placeId: "", country: "", state: "" } : null;
};

const measuredKm = (loading, offloading) => {
    if (!loading?.address || !offloading?.address || loading.address === offloading.address) return null;
    const hit = cache.distances[`${loading.address}|${offloading.address}`];
    return hit?.ok ? hit.km : null;
};

/**
 * Pass 1 — read every row into a plain record, then fill the gaps.
 */
const stats = {
    orderIdKept: 0, orderIdFromSequence: 0, orderIdSynthesized: 0, orderIdDeduped: 0,
    distanceFromSheet: 0, distanceMeasured: 0, distanceMissing: 0,
    addressGeocoded: 0, addressUnresolved: 0, addressUnknown: 0, addressInferred: 0,
    routeFromCountries: 0, routeFromSheet: 0,
    tripTypeFromSheet: 0, tripTypeFromRoute: 0, tripTypeDefaulted: 0,
    loadTypeFromSheet: 0, loadTypeFromRoute: 0, loadTypeFromWeight: 0, loadTypeDefaulted: 0,
    categoryFromSheet: 0, categoryFromDescription: 0, categoryDefaulted: 0,
    podFromSheet: 0, podDerived: 0, podNone: 0,
    truckAgeFromSheet: 0, truckAgeFromPlate: 0, truckAgeMissing: 0,
    offloadingDateFromSheet: 0, offloadingDateEstimated: 0,
    weightUnitDefaulted: 0, statusDefaulted: 0, negativeTravelDays: 0,
};
const warnings = [];
const inconsistent = [];

const records = rows.map((row, position) => {
    const raw = {
        sheetRow: position + map.HEADER_ROW + 1,
        id: norm(cell(row, "Order Id")),
        shipper: norm(cell(row, "Shipper")),
        carrier: norm(cell(row, "Carrier")),
        loadingRaw: norm(cell(row, "Loading Address")),
        offloadingRaw: norm(cell(row, "Offloading Address")),
        status: map.status(cell(row, "Status")),
        statusLabel: norm(cell(row, "Status")),
        dealDate: map.date(cell(row, "Deal Date")),
        row,
    };
    return raw;
});

/**
 * Order ids.
 *
 * Three populations live in the Order Id column: proper "APPL021.26" ids,
 * bare sequence numbers (the 2026 block lost its formatting — the numbers
 * still line up with the ids the app generated), and nothing at all (the
 * 2022-2023 history, which predates the numbering). The last two get an id
 * built from the row's year and the first sequence free in that year, so the
 * database can key on order_id the way the app does.
 */
const ORDER_ID = /^APPL(\d+)\.(\d{2})$/;

const ownYear = (record) => {
    const fromDeal = record.dealDate ? Number(record.dealDate.slice(0, 4)) : null;
    if (fromDeal) return fromDeal;
    for (const header of ["Expected Loading Date", "Actual Loading Date", "Proposed Loading Date", "Expected Offloading Date"]) {
        const value = map.year(cell(record.row, header));
        if (value) return value;
    }
    const match = record.id.match(ORDER_ID);
    return match ? 2000 + Number(match[2]) : null;
};

// A handful of rows carry no date in any column. The logbook is kept in
// chronological blocks, so the year of the nearest dated neighbour is the
// year of the row — that is how a person reading the sheet would place it.
const ownYears = records.map(ownYear);
const yearOf = (record) => {
    const position = records.indexOf(record);
    if (ownYears[position]) return ownYears[position];
    for (let distance = 1; distance < records.length; distance++) {
        const above = ownYears[position - distance];
        const below = ownYears[position + distance];
        if (above) return above;
        if (below) return below;
    }
    return null;
};

const takenByYear = new Map(); // year -> Set(seq)
const claim = (fullYear, seq) => {
    const taken = takenByYear.get(fullYear) ?? new Set();
    taken.add(seq);
    takenByYear.set(fullYear, taken);
};

// First pass: keep the ids the sheet already states, so synthesized ones
// never collide with them
for (const record of records) {
    const match = record.id.match(ORDER_ID);
    if (!match) continue;
    const fullYear = 2000 + Number(match[2]);
    const seq = Number(match[1]);
    const taken = takenByYear.get(fullYear);
    if (taken?.has(seq)) continue; // duplicate: resolved in the second pass
    record.orderId = record.id;
    record.year = fullYear;
    record.seq = seq;
    claim(fullYear, seq);
    stats.orderIdKept++;
}

const nextFree = (fullYear) => {
    const taken = takenByYear.get(fullYear) ?? new Set();
    let seq = 1;
    while (taken.has(seq)) seq++;
    return seq;
};

// Second pass: bare sequence numbers, then rows with no id, then the
// duplicate that lost the first pass. Ordered by deal date so the
// synthesized sequences run chronologically.
const unnumbered = records.filter((record) => !record.orderId);
unnumbered.sort((a, b) => String(a.dealDate ?? "9999").localeCompare(String(b.dealDate ?? "9999")) || a.sheetRow - b.sheetRow);

for (const record of unnumbered) {
    const fullYear = yearOf(record);
    if (!fullYear) {
        record.skip = "no date anywhere on the row, cannot assign a year";
        continue;
    }

    const bare = /^\d+$/.test(record.id) ? Number(record.id) : null;
    const taken = takenByYear.get(fullYear) ?? new Set();

    let seq;
    if (bare !== null && !taken.has(bare)) {
        seq = bare;
        stats.orderIdFromSequence++;
    } else {
        seq = nextFree(fullYear);
        if (record.id) stats.orderIdDeduped++;
        else stats.orderIdSynthesized++;
        if (record.id) {
            warnings.push(`sheet row ${record.sheetRow}: "${record.id}" already used — stored as APPL${String(seq).padStart(3, "0")}.${String(fullYear).slice(2)}`);
        }
    }

    record.orderId = `APPL${String(seq).padStart(3, "0")}.${String(fullYear).slice(2)}`;
    record.year = fullYear;
    record.seq = seq;
    claim(fullYear, seq);
}

/**
 * Addresses. A handful of rows carry no route at all; where the shipper only
 * ever ran one route, that route is used, otherwise the location is marked
 * unknown rather than invented.
 */
const shipperRoutes = new Map(); // shipper -> Map("loading|offloading" -> [loading, offloading, count])
for (const record of records) {
    if (!record.loadingRaw || !record.offloadingRaw) continue;
    const routes = shipperRoutes.get(key(record.shipper)) ?? new Map();
    const pairKey = `${key(record.loadingRaw)}|${key(record.offloadingRaw)}`;
    const existing = routes.get(pairKey);
    routes.set(pairKey, [record.loadingRaw, record.offloadingRaw, (existing?.[2] ?? 0) + 1]);
    shipperRoutes.set(key(record.shipper), routes);
}

for (const record of records) {
    let { loadingRaw, offloadingRaw } = record;

    if (!loadingRaw && !offloadingRaw) {
        const routes = shipperRoutes.get(key(record.shipper));
        // Only when the shipper has run exactly one route, ever
        if (routes?.size === 1) {
            const [only] = [...routes.values()];
            [loadingRaw, offloadingRaw] = only;
            record.addressInferred = true;
            stats.addressInferred++;
        }
    }

    record.loading = located(loadingRaw) ?? UNKNOWN_LOCATION;
    record.offloading = located(offloadingRaw) ?? UNKNOWN_LOCATION;

    for (const location of [record.loading, record.offloading]) {
        if (location === UNKNOWN_LOCATION) stats.addressUnknown++;
        else if (location.placeId) stats.addressGeocoded++;
        else stats.addressUnresolved++;
    }
}

/**
 * Trip type, load type and truck age: propagate what the logbook does state
 * onto the rows that leave them blank, keyed on the resolved route (the same
 * town is spelled a dozen ways in the raw column, but geocoding collapses
 * them onto one canonical address).
 */
const routeKey = (record) => `${record.loading.address}|${record.offloading.address}`;

const majorityBy = (keyOf, header, translate) => {
    const tally = new Map();
    for (const record of records) {
        const value = translate(cell(record.row, header));
        if (!value) continue;
        const k = keyOf(record);
        if (!k) continue;
        const counts = tally.get(k) ?? new Map();
        counts.set(value, (counts.get(value) ?? 0) + 1);
        tally.set(k, counts);
    }
    const winner = new Map();
    for (const [k, counts] of tally) {
        winner.set(k, [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    }
    return winner;
};

const tripTypeByRoute = majorityBy(routeKey, "Trip Type", map.tripType);
const loadTypeByRoute = majorityBy(routeKey, "Load type", map.loadType);
const truckAgeByPlate = majorityBy((record) => plate(cell(record.row, "Truck Plate")) || null, "Truck Age", map.truckAge);

/**
 * Pass 2 — the full row, gaps filled.
 */
const orders = [];
const skipped = [];

for (const record of records) {
    if (record.skip) {
        skipped.push(`sheet row ${record.sheetRow}: ${record.skip}`);
        continue;
    }
    if (!record.shipper) {
        skipped.push(`sheet row ${record.sheetRow} (${record.orderId}): no shipper`);
        continue;
    }
    if (!record.status) {
        if (record.statusLabel) {
            skipped.push(`sheet row ${record.sheetRow} (${record.orderId}): unmapped status "${record.statusLabel}"`);
            continue;
        }
        // Blank status: an order that never left the enquiry stage
        record.status = "prospect";
        stats.statusDefaulted++;
    }

    const read = (header) => cell(record.row, header);

    // --- dates
    const expectedLoadingDate =
        map.date(read("Expected Loading Date")) ??
        map.date(read("Proposed Loading Date")) ??
        map.date(read("Actual Loading Date")) ??
        record.dealDate ??
        `${record.year}-01-01 00:00:00`;

    // --- distance: the logbook's own figure wins; the road distance fills blanks
    const statedKm = map.integer(read("Distance"));
    const roadKm = measuredKm(record.loading, record.offloading);
    let distance = null;
    if (statedKm !== null && statedKm > 0) { distance = statedKm; stats.distanceFromSheet++; }
    // A trip that ran covered some ground: an intra-city move, or a leg whose
    // destination had to be routed via its province seat, still rounds to at
    // least a kilometre rather than to zero
    else if (roadKm !== null) { distance = Math.max(1, roadKm); stats.distanceMeasured++; }
    else stats.distanceMissing++;

    // --- offloading date
    let expectedOffloadingDate =
        map.date(read("Expected Offloading Date")) ??
        map.date(read("Proposed Offloading Date")) ??
        map.date(read("Actual Offloading Date"));
    if (expectedOffloadingDate) stats.offloadingDateFromSheet++;
    else {
        expectedOffloadingDate = map.addDays(expectedLoadingDate, map.estimateTransitDays(distance));
        stats.offloadingDateEstimated++;
    }

    // --- route
    const statedRoute = map.route(read("Route"));
    const route = map.deriveRoute(record.loading, record.offloading, statedRoute);
    if (record.loading.country && record.offloading.country) stats.routeFromCountries++;
    else stats.routeFromSheet++;

    // --- weights
    const loadedWeight = map.weight(read("Loaded Weight"));
    const offloadedWeight = map.weight(read("Offloaded Weight"));
    const statedWeight = map.weight(read("Weight"));
    const weightValue = statedWeight ?? loadedWeight ?? offloadedWeight ?? "0.000";
    const tons = Number(weightValue) > 0 ? Number(weightValue) : null;

    // --- trip type
    let tripType = map.tripType(read("Trip Type"));
    if (tripType) stats.tripTypeFromSheet++;
    else if ((tripType = tripTypeByRoute.get(routeKey(record)) ?? null)) stats.tripTypeFromRoute++;
    else { tripType = "normal"; stats.tripTypeDefaulted++; }

    // --- load type
    let loadType = map.loadType(read("Load type"));
    if (loadType) stats.loadTypeFromSheet++;
    else if ((loadType = loadTypeByRoute.get(routeKey(record)) ?? null)) stats.loadTypeFromRoute++;
    else if ((loadType = map.deriveLoadType(tons))) stats.loadTypeFromWeight++;
    else { loadType = "dedicated"; stats.loadTypeDefaulted++; }

    // --- category
    const description = map.text(read("Cargo Description")) ?? "";
    let category = map.category(read("Cargo Category"));
    if (category) stats.categoryFromSheet++;
    else if ((category = map.categoryFromDescription(description))) stats.categoryFromDescription++;
    else { category = "other"; stats.categoryDefaulted++; }

    // --- proof of delivery
    let podStatus = map.podStatus(read("POD Status"));
    if (podStatus) stats.podFromSheet++;
    else if ((podStatus = map.derivePodStatus(record.status))) stats.podDerived++;
    else stats.podNone++;

    // --- truck age
    const truckPlate = plate(read("Truck Plate")) || null;
    let truckAge = map.truckAge(read("Truck Age"));
    if (truckAge) stats.truckAgeFromSheet++;
    else if (truckPlate && (truckAge = truckAgeByPlate.get(truckPlate) ?? null)) stats.truckAgeFromPlate++;
    else stats.truckAgeMissing++;

    const weightUnit = map.weightUnit(read("Weight Uint")) ?? "ton";
    if (!map.weightUnit(read("Weight Uint"))) stats.weightUnitDefaulted++;

    const departureLoading = map.date(read("Departure from Loading"));
    const arrivalOffloading = map.date(read("Arrival at Offloading"));

    // The logbook has rows whose offloading block was typed with the wrong
    // month — its own "Days Spend Traveling" formula shows the negative
    // result. The dates are imported as recorded (the sheet is the record),
    // but a negative duration is dropped rather than stored, and the row is
    // listed at the end so it can be corrected at the source.
    if (expectedOffloadingDate && expectedOffloadingDate < expectedLoadingDate) {
        inconsistent.push(
            `${record.orderId} (sheet row ${record.sheetRow}): offloading ${expectedOffloadingDate.slice(0, 10)} is before loading ${expectedLoadingDate.slice(0, 10)}`,
        );
    }

    const statedTravelDays = map.integer(read("Days Spend Traveling"));
    const travelDays = statedTravelDays !== null && statedTravelDays >= 0
        ? statedTravelDays
        : map.daysBetween(departureLoading, arrivalOffloading);
    if (statedTravelDays !== null && statedTravelDays < 0) stats.negativeTravelDays++;

    orders.push({
        id: randomUUID(),
        orderId: record.orderId,
        seq: record.seq,
        year: record.year,

        shipperName: record.shipper,
        carrierName: record.carrier || null,

        loadingAddress: record.loading,
        expectedLoadingDate,
        proposedLoadingDate: map.date(read("Proposed Loading Date")),
        arrivalAtLoading: map.date(read("Arrival at Loading")),
        arrivalOnTimeLoading: map.boolean(read("Arrival On Time at Loading")),
        actualLoadingDate: map.date(read("Actual Loading Date")),
        daysSpendNotLoading: map.integer(read("Days Spent not Loading")),
        departureLoadingDate: departureLoading,
        demurrageAtLoading: map.boolean(read("Demurrage at Loading")) ?? false,
        demurrageChargedAtLoading: map.boolean(read("Demurrage Charged At Loading")) ?? false,
        demurrageChargedDaysAtLoading: map.integer(read("Demurrage Charged Days At Loading")) ?? 0,

        offloadingAddress: record.offloading,
        expectedOffloadingDate,
        proposedOffloadingDate: map.date(read("Proposed Offloading Date")),
        arrivalAtOffloading: arrivalOffloading,
        arrivalOnTimeOffloading: map.boolean(read("Arrival On Time at Offloading")),
        actualOffloadingDate: map.date(read("Actual Offloading Date")),
        daysSpendNotOffloading: map.integer(read("Days Spent not Offloading")),
        departureOffloadingDate: map.date(read("Departure from Offloading")),
        demurrageAtOffloading: map.boolean(read("Demurrage at Offloading")) ?? false,
        demurrageChargedAtOffloading: map.boolean(read("Demurrage Charged At Offloading")) ?? false,
        demurrageChargedDaysAtOffloading: map.integer(read("Demurrage Charged Days At Offloading")) ?? 0,

        arrivalAtBorder: map.date(read("Arrival at Border")),
        departureFromBorder: map.date(read("Departure from Border")),
        daysSpendAtBorder: map.integer(read("Days Spent at Border")),
        demurrageAtBorder: map.boolean(read("Demurrage at Border")) ?? false,
        demurrageChargedAtBorder: map.boolean(read("Demurrage Charged At Border")) ?? false,
        demurrageChargedDaysAtBorder: map.integer(read("Demurrage Charged Days At Border")) ?? 0,

        distance,
        daysSpendTraveling: travelDays,

        category,
        description,
        weight: weightValue,
        loadedWeight,
        offloadedWeight,
        weightUnit,
        packing: map.packing(read("Packing")),
        isHazardous: map.boolean(read("Is Hazarduos?")) ?? false,
        hazchemCode: map.text(read("Hazchem Code")),
        isRefrigerated: map.boolean(read("Is Refrigerated?")) ?? false,
        temperature: map.number(read("Travel Temperature")) === null ? null : String(map.number(read("Travel Temperature"))),
        temperatureInstructions: map.text(read("Travel Temperatarute Intructions")),

        status: record.status,
        route,
        tripType,
        loadType,
        deliveries: map.integer(read("Deliveries")) ?? 1,
        podStatus,

        truckPlate,
        trailerPlate: plate(read("Trailer Plate")) || null,
        linkPlate: plate(read("Link Plate")) || null,
        truckAge,
        loadingCapacity: map.number(read("Loading Capacity")),

        driverName: map.text(read("Driver Name")),
        driverPhoneNumber: map.text(read("Contact")),
        driverPassport: map.text(read("Passport")),

        dealDate: record.dealDate,
        fiscalRegime: map.fiscalRegime(read("Fiscal Regime")),

        carrierInvoiceNumber: map.text(read("Carrier Invoice Number")),
        carrierInvoiceDate: map.date(read("Carrier Invoice Date")),
        carrierSubtotal: map.money(read("Carrier Invoice Subtotal")),
        carrierVAT: map.money(read("Carrier Invoice VAT")),
        carrierTotal: map.money(read("Carrier Invoice Total")),
        carrierCurrency: map.currency(read("Carrier Invoice Currency")) ?? "MZN",
        carrierPaidAmount: map.money(read("Carrier Paid Amount")),
        carrierPaidPercentage: map.percent(read("Carrier Paid Percentage")),
        carrierPaymentStatus: map.paymentStatus(read("Carrier Paymement Status")),
        carrierRemainingAmount: map.money(read("Carrier Remaining Amount")),
        carrierRemainingPercentage: map.percent(read("Carrier Remainning Percentage")),
        carrierFullPaymentDate: map.date(read("Carrier Full Payment Date")),

        insuranceSubscriber: map.insuranceSubscriber(read("Insuerance Subscriber")),
        insuranceValue: map.money(read("Insurance Value")),
        insuranceCurrency: map.currency(read("Insurance Currency")),
        insuranceStatus: map.insuranceStatus(read("Insurance Status")),

        apploadCommissionSubtotal: map.money(read("Appload Comission Subtotal")),
        apploadCommissionVAT: map.money(read("Appload Comission VAT")),
        apploadCommissionTotal: map.money(read("Appload Comission Total")),

        shipperInvoiceNumber: map.text(read("Shipper Invoice Number")),
        shipperInvoiceDate: map.date(read("Shipper Invoice Date")),
        shipperSubtotal: map.money(read("Shipper Invoice Subtotal")),
        shipperVAT: map.money(read("Shipper Invoice VAT")),
        shipperTotal: map.money(read("Shipper Invoice Total")),
        shipperCurrency: map.currency(read("Shipper Invoice Currency")) ?? "MZN",
        shipperReceivedAmount: map.money(read("Shipper Received Amount")),
        shipperReceivedPercentage: map.percent(read("Shipper Received Percentage")),
        shipperPaymentStatus: map.paymentStatus(read("Shipper Paymement Status")),
        shipperRemainingAmount: map.money(read("Shipper Remaining Amount")),
        shipperRemainingPercentage: map.percent(read("Shipper Remainning Percentage")),
        shipperFullPaymentDate: map.date(read("Shipper Full Payment Date")),

        numberOfMechanicalFailuresStops: map.integer(read("Number of Mechanical Failures Stops")) ?? 0,
        totalMechanicalFailuresDelayedDays: map.integer(read("Total Mechanical Failures Delayed in Days")),
        numberOfDocumentationIssuesStops: map.integer(read("Number of Documentation Issues Stops")) ?? 0,
        totalDocumentationIssuesDelayedDays: map.integer(read("Total Documentation Issues Delayed in Days")),
        numberOfPoliceStops: map.integer(read("Number of Police Stops")) ?? 0,
        totalPoliceDelayedDays: map.integer(read("Total Police Delayed in Days")),
        numberAccidents: map.integer(read("Number of Accidents")) ?? 0,
        cargoDamaged: map.boolean(read("Cargo Damaged?")) ?? false,
        damagedPercent: map.percent(read("Damaged Percent")),
        claimed: map.boolean(read("Claimed")) ?? false,

        ageFactor: map.number(read("Age Factor")) === null ? null : String(map.number(read("Age Factor"))),
        loadFactor: map.number(read("Load Factor")) === null ? null : String(map.number(read("Load Factor"))),
        defaultCoefficient: map.number(read("Default Coefficient")) === null ? null : String(map.number(read("Default Coefficient"))),

        createdAt: record.dealDate ?? expectedLoadingDate,
    });
}

console.log(`${orders.length} orders prepared, ${skipped.length} skipped\n`);

/**
 * Organizations
 */
const organizations = new Map(); // `${type}:${key(name)}` -> row
const usedOrgSlugs = new Set();

const ensureOrganization = (name, type) => {
    const k = `${type}:${key(name)}`;
    const existing = organizations.get(k);
    if (existing) return existing;

    // slug, email and nuit are all unique columns, and truncating a long
    // company name can make two of them agree — so the slug is made unique
    // once and the other two are derived from it
    const ordinal = organizations.size + 1;
    let slug = `${slugify(name)}-${type}`.slice(0, 50);
    while (usedOrgSlugs.has(slug)) slug = `${slug.slice(0, 44)}-${ordinal}`;
    usedOrgSlugs.add(slug);

    const row = {
        id: randomUUID(),
        name,
        slug,
        type,
        // NOT NULL and unique in the schema; the dev logbook's party tabs are
        // empty, so there is no real NUIT or contact to import
        nuit: `DEV${String(ordinal).padStart(6, "0")}`,
        email: `${slug}@dev.appload.local`,
        phoneNumber: `+258000${String(ordinal).padStart(6, "0")}`,
    };
    organizations.set(k, row);
    return row;
};

for (const order of orders) {
    order.shipperId = ensureOrganization(order.shipperName, "shipper").id;
    order.carrierId = order.carrierName ? ensureOrganization(order.carrierName, "carrier").id : null;
}

/**
 * Fleet. Plates come off the order rows; everything a vehicle record needs
 * beyond the plate (brand, model, VIN) is unknown to the logbook and is
 * filled with an explicit placeholder rather than guessed.
 *
 * A plate's identity is its alphanumerics: the logbook spells the same
 * vehicle "KR 92 SB GP" on one row and "KR92 SB GP" on the next, and those
 * are one truck, not two. The spelling used most often becomes the stored
 * registration and every order that names the vehicle is pointed at it.
 */
const plateIdentity = (registration) => registration.replace(/[^A-Z0-9]/g, "");

let mergedPlates = 0;

const buildFleet = (plateOf, kind) => {
    const byIdentity = new Map();
    for (const order of orders) {
        const registration = plateOf(order);
        if (!registration || !order.carrierId) continue;
        const identity = plateIdentity(registration);
        if (!identity) continue;
        const entry = byIdentity.get(identity)
            ?? { spellings: new Map(), carriers: new Map(), firstYear: order.year, capacity: null, articulated: false };
        entry.spellings.set(registration, (entry.spellings.get(registration) ?? 0) + 1);
        entry.carriers.set(order.carrierId, (entry.carriers.get(order.carrierId) ?? 0) + 1);
        entry.firstYear = Math.min(entry.firstYear, order.year);
        if (order.loadingCapacity) entry.capacity ??= order.loadingCapacity;
        if (kind === "truck" && (order.trailerPlate || order.linkPlate)) entry.articulated = true;
        byIdentity.set(identity, entry);
    }

    const mostCommon = (counts) => [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

    return [...byIdentity.entries()].map(([identity, entry]) => {
        if (entry.spellings.size > 1) mergedPlates += entry.spellings.size - 1;
        return {
            id: randomUUID(),
            identity,
            regPlate: mostCommon(entry.spellings),
            // A plate that shows up under several carriers belongs to the one
            // that ran it most; subcontracting makes the rest noise
            carrierId: mostCommon(entry.carriers),
            brand: "Unknown",
            model: "Unknown",
            // Not the build year — the logbook does not record it. This is the
            // first year the plate appears, which keeps the value inside the
            // range the app's year picker offers.
            year: entry.firstYear,
            type: entry.articulated ? "articulated" : "non-articulated",
            vin: `DEV-${kind.toUpperCase()}-${identity}`.slice(0, 40),
            loadingBay: {
                // A standard Mozambican tri-axle superlink deck
                width: 2.5, length: 13.6, height: 2.7, volume: 91.8,
                capacity: entry.capacity && entry.capacity > 0 ? entry.capacity : 34,
                type: "flatbed",
            },
        };
    });
};

const trucks = buildFleet((order) => order.truckPlate, "truck");
const trailers = buildFleet((order) => order.trailerPlate, "trailer");
const links = buildFleet((order) => order.linkPlate, "link");

const truckByIdentity = new Map(trucks.map((truck) => [truck.identity, truck]));
const trailerByIdentity = new Map(trailers.map((trailer) => [trailer.identity, trailer]));
const linkByIdentity = new Map(links.map((link) => [link.identity, link]));

// The order's plate columns are foreign keys onto reg_plate, so each one is
// rewritten to the canonical spelling — or dropped when no fleet row could
// be built (the row named no carrier to own the vehicle)
let droppedPlates = 0;
const resolvePlate = (registration, index) => {
    if (!registration) return null;
    const match = index.get(plateIdentity(registration));
    if (!match) { droppedPlates++; return null; }
    return match.regPlate;
};

for (const order of orders) {
    order.truckPlate = resolvePlate(order.truckPlate, truckByIdentity);
    order.trailerPlate = resolvePlate(order.trailerPlate, trailerByIdentity);
    order.linkPlate = resolvePlate(order.linkPlate, linkByIdentity);
}

const truckByPlate = new Map(trucks.map((truck) => [truck.regPlate, truck]));

/**
 * Drivers. The driver table hangs off a user row, so each imported driver
 * gets one, flagged by an obviously synthetic address.
 */
const driverEntries = new Map(); // key(name) -> entry
for (const order of orders) {
    if (!order.driverName || !order.carrierId) continue;
    const k = key(order.driverName);
    const entry = driverEntries.get(k) ?? { name: order.driverName, carriers: new Map(), phones: new Map(), passport: null, trucks: new Map() };
    entry.carriers.set(order.carrierId, (entry.carriers.get(order.carrierId) ?? 0) + 1);
    if (order.driverPhoneNumber) entry.phones.set(order.driverPhoneNumber, (entry.phones.get(order.driverPhoneNumber) ?? 0) + 1);
    if (order.driverPassport) entry.passport ??= order.driverPassport;
    if (order.truckPlate) entry.trucks.set(order.truckPlate, (entry.trucks.get(order.truckPlate) ?? 0) + 1);
    driverEntries.set(k, entry);
}

const usedSlugs = new Set();
const usedPhones = new Set();
const drivers = [];
for (const [k, entry] of driverEntries) {
    let slug = slugify(entry.name).slice(0, 40);
    while (usedSlugs.has(slug)) slug = `${slug}-${drivers.length}`;
    usedSlugs.add(slug);

    const mostUsedPhone = [...entry.phones.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    // user.phone_number is unique; drivers sharing a handset keep only one
    const phone = mostUsedPhone && !usedPhones.has(mostUsedPhone) ? mostUsedPhone : null;
    if (phone) usedPhones.add(phone);

    const truckPlate = [...entry.trucks.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    drivers.push({
        key: k,
        id: randomUUID(),
        userId: randomUUID(),
        name: entry.name,
        email: `${slug}@dev-drivers.appload.local`,
        phone,
        passport: entry.passport,
        carrierId: [...entry.carriers.entries()].sort((a, b) => b[1] - a[1])[0][0],
        truckId: truckPlate ? (truckByPlate.get(truckPlate)?.id ?? null) : null,
    });
}

const driverByKey = new Map(drivers.map((driver) => [driver.key, driver]));
for (const order of orders) {
    order.driverId = order.driverName ? (driverByKey.get(key(order.driverName))?.id ?? null) : null;
}

/**
 * Plan
 */
console.log("to insert:");
console.log(`  organizations  ${organizations.size}  (${[...organizations.values()].filter((o) => o.type === "shipper").length} shippers, ${[...organizations.values()].filter((o) => o.type === "carrier").length} carriers)`);
console.log(`  trucks         ${trucks.length}`);
console.log(`  trailers       ${trailers.length}`);
console.log(`  links          ${links.length}`);
console.log(`  drivers        ${drivers.length}  (+ ${drivers.length} driver user rows)`);
console.log(`  orders         ${orders.length}`);

if (DRY) {
    report();
    process.exit(0);
}

if (!ASSUME_YES) {
    console.log("\nThis DELETES every order, organization and fleet row in the database above.");
    console.log("Re-run with --yes to proceed.");
    process.exit(1);
}

/**
 * Wipe. One TRUNCATE so the mutual foreign keys never see an inconsistent
 * intermediate state; RESTART IDENTITY resets the legacy_id sequences.
 */
console.log("\nwiping...");
await q(`
    TRUNCATE TABLE
        notification, notification_cursor,
        thread_message, thread_read, thread_participant, thread,
        order_loading_check, order_dispatch_document, order_dispatch,
        movement_event, movement_cost, movement_document,
        movement_location, movement_tracking_request, movement_route, movement,
        organization_counter,
        order_request, quote, partner_connection, organization_claim, subscription_usage,
        order_document, order_history, order_offer, sheet_sync, tracking_request,
        chat_message, chat_conversation, "order",
        network, ops_order, kyc, member, invitation,
        driver, link, trailer, truck, organization
    RESTART IDENTITY
`);
// Polymorphic, so TRUNCATE cannot reach it through a foreign key
await q(`DELETE FROM kyc_document`);
// Audit trail of actions against rows that no longer exist
await q(`DELETE FROM activity_log WHERE entity_type IN ('order', 'organization', 'truck', 'trailer', 'link', 'driver', 'conversation')`);
// Driver users from an earlier run of this script
await q(`DELETE FROM "user" WHERE email LIKE '%@dev-drivers.appload.local'`);

/**
 * Insert. Batched multi-row statements — one round trip per statement over
 * the HTTP driver, so a row at a time would take minutes.
 */
async function insertMany(table, columnNames, rowsToInsert, toValues, batchSize = 200) {
    let inserted = 0;
    for (let start = 0; start < rowsToInsert.length; start += batchSize) {
        const batch = rowsToInsert.slice(start, start + batchSize);
        const params = [];
        const tuples = batch.map((row) => {
            const values = toValues(row);
            return `(${values.map((value) => { params.push(value); return `$${params.length}`; }).join(", ")})`;
        });
        await q(`INSERT INTO ${table} (${columnNames.join(", ")}) VALUES ${tuples.join(", ")}`, params);
        inserted += batch.length;
    }
    return inserted;
}

const json = (value) => JSON.stringify(value);

console.log("inserting organizations...");
await insertMany(
    "organization",
    ["id", "name", "slug", "created_at", "nuit", "type", "status", "email", "phone_number", "kyc_status"],
    [...organizations.values()],
    (o) => [o.id, o.name, o.slug, new Date().toISOString(), o.nuit, o.type, "active", o.email, o.phoneNumber, "draft"],
);

console.log("inserting trucks...");
await insertMany(
    "truck",
    ["id", "carrier_id", "reg_plate", "brand", "model", "year", "type", "loading_bay", "vin", "status", "kyc_status"],
    trucks,
    (t) => [t.id, t.carrierId, t.regPlate, t.brand, t.model, t.year, t.type, json(t.loadingBay), t.vin, "idle", "draft"],
);

console.log("inserting trailers...");
await insertMany(
    "trailer",
    ["id", "carrier_id", "reg_plate", "brand", "model", "year", "loading_bay", "vin", "status", "kyc_status"],
    trailers,
    (t) => [t.id, t.carrierId, t.regPlate, t.brand, t.model, t.year, json(t.loadingBay), t.vin, "idle", "draft"],
);

console.log("inserting links...");
await insertMany(
    "link",
    ["id", "carrier_id", "reg_plate", "brand", "model", "year", "loading_bay", "vin", "status", "kyc_status"],
    links,
    (l) => [l.id, l.carrierId, l.regPlate, l.brand, l.model, l.year, json(l.loadingBay), l.vin, "idle", "draft"],
);

console.log("inserting driver users...");
await insertMany(
    "\"user\"",
    ["id", "name", "email", "email_verified", "phone_number", "role", "type", "status", "created_at", "updated_at"],
    drivers,
    (d) => [d.userId, d.name, d.email, false, d.phone, "user", "driver", "active", new Date().toISOString(), new Date().toISOString()],
);

console.log("inserting drivers...");
await insertMany(
    "driver",
    ["id", "user_id", "carrier_id", "truck_id", "passport", "status", "kyc_status"],
    drivers,
    (d) => [d.id, d.userId, d.carrierId, d.truckId, d.passport, "idle", "draft"],
);

const ORDER_COLUMNS = [
    ["id", (o) => o.id],
    ["order_id", (o) => o.orderId],
    ["seq", (o) => o.seq],
    ["year", (o) => o.year],
    ["shipper_name", (o) => o.shipperName],
    ["shipper_id", (o) => o.shipperId],
    ["loading_address::jsonb", (o) => json(o.loadingAddress)],
    ["expected_loading_date::timestamp", (o) => o.expectedLoadingDate],
    ["proposed_loading_date::timestamp", (o) => o.proposedLoadingDate],
    ["arrival_at_loading::timestamp", (o) => o.arrivalAtLoading],
    ["arrival_ontime_loading", (o) => o.arrivalOnTimeLoading],
    ["actual_loading_date::timestamp", (o) => o.actualLoadingDate],
    ["days_spend_not_loading", (o) => o.daysSpendNotLoading],
    ["departure_loading_date::timestamp", (o) => o.departureLoadingDate],
    ["demurrage_at_loading", (o) => o.demurrageAtLoading],
    ["demurrage_charged_at_loading", (o) => o.demurrageChargedAtLoading],
    ["demurrage_charge_days_at_loading", (o) => o.demurrageChargedDaysAtLoading],
    ["offloading_address::jsonb", (o) => json(o.offloadingAddress)],
    ["expected_offloading_date::timestamp", (o) => o.expectedOffloadingDate],
    ["proposed_offloading_date::timestamp", (o) => o.proposedOffloadingDate],
    ["arrival_at_offloading::timestamp", (o) => o.arrivalAtOffloading],
    ["arrival_ontime_offloading", (o) => o.arrivalOnTimeOffloading],
    ["actual_offloading_date::timestamp", (o) => o.actualOffloadingDate],
    ["days_spend_not_offloading", (o) => o.daysSpendNotOffloading],
    ["departure_offloading_date::timestamp", (o) => o.departureOffloadingDate],
    ["demurrage_at_offloading", (o) => o.demurrageAtOffloading],
    ["demurrage_charged_at_offloading", (o) => o.demurrageChargedAtOffloading],
    ["demurrage_charge_days_at_offloading", (o) => o.demurrageChargedDaysAtOffloading],
    ["arrival_at_border::timestamp", (o) => o.arrivalAtBorder],
    ["departure_from_border::timestamp", (o) => o.departureFromBorder],
    ["days_spend_at_border", (o) => o.daysSpendAtBorder],
    ["demurrage_at_border", (o) => o.demurrageAtBorder],
    ["demurrage_charged_at_border", (o) => o.demurrageChargedAtBorder],
    ["demurrage_charge_days_at_border", (o) => o.demurrageChargedDaysAtBorder],
    ["distance", (o) => o.distance],
    ["days_spend_traveling", (o) => o.daysSpendTraveling],
    ["category", (o) => o.category],
    ["description", (o) => o.description],
    ["weight", (o) => o.weight],
    ["loaded_weight", (o) => o.loadedWeight],
    ["offloaded_weight", (o) => o.offloadedWeight],
    ["weight_unit", (o) => o.weightUnit],
    ["packing", (o) => o.packing],
    ["is_hazardous", (o) => o.isHazardous],
    ["hazchem_code", (o) => o.hazchemCode],
    ["is_refrigerated", (o) => o.isRefrigerated],
    ["temperature", (o) => o.temperature],
    ["temperature_instructions", (o) => o.temperatureInstructions],
    ["status", (o) => o.status],
    ["route", (o) => o.route],
    ["trip_type", (o) => o.tripType],
    ["load_type", (o) => o.loadType],
    ["deliveries", (o) => o.deliveries],
    ["pod_status", (o) => o.podStatus],
    ["carrier_name", (o) => o.carrierName],
    ["carrier_id", (o) => o.carrierId],
    ["driver_name", (o) => o.driverName],
    ["driver_id", (o) => o.driverId],
    ["driver_passport", (o) => o.driverPassport],
    ["driver_phone_number", (o) => o.driverPhoneNumber],
    ["truck_plate", (o) => o.truckPlate],
    ["trailer_plate", (o) => o.trailerPlate],
    ["link_plate", (o) => o.linkPlate],
    ["truck_age", (o) => o.truckAge],
    ["deal_date::timestamp", (o) => o.dealDate],
    ["fiscal_regime", (o) => o.fiscalRegime],
    ["carrier_invoice_number", (o) => o.carrierInvoiceNumber],
    ["carrier_invoice_date::timestamp", (o) => o.carrierInvoiceDate],
    ["carrier_subtotal", (o) => o.carrierSubtotal],
    ["carrier_vat", (o) => o.carrierVAT],
    ["carrier_total", (o) => o.carrierTotal],
    ["carrier_currency", (o) => o.carrierCurrency],
    ["carrier_paid_amount", (o) => o.carrierPaidAmount],
    ["carrier_paid_percentage", (o) => o.carrierPaidPercentage],
    ["carrier_payment_status", (o) => o.carrierPaymentStatus],
    ["carrier_remaining_amount", (o) => o.carrierRemainingAmount],
    ["carrier_remaining_percentage", (o) => o.carrierRemainingPercentage],
    ["carrier_full_payment_date::timestamp", (o) => o.carrierFullPaymentDate],
    ["insurance_subscriber", (o) => o.insuranceSubscriber],
    ["insurance_value", (o) => o.insuranceValue],
    ["insurance_currency", (o) => o.insuranceCurrency],
    ["insurance_status", (o) => o.insuranceStatus],
    ["appload_commission_subtotal", (o) => o.apploadCommissionSubtotal],
    ["appload_commission_vat", (o) => o.apploadCommissionVAT],
    ["appload_commission_total", (o) => o.apploadCommissionTotal],
    ["shipper_invoice_number", (o) => o.shipperInvoiceNumber],
    ["shipper_invoice_date::timestamp", (o) => o.shipperInvoiceDate],
    ["shipper_subtotal", (o) => o.shipperSubtotal],
    ["shipper_vat", (o) => o.shipperVAT],
    ["shipper_total", (o) => o.shipperTotal],
    ["shipper_currency", (o) => o.shipperCurrency],
    ["shipper_received_amount", (o) => o.shipperReceivedAmount],
    ["shipper_received_percentage", (o) => o.shipperReceivedPercentage],
    ["shipper_payment_status", (o) => o.shipperPaymentStatus],
    ["shipper_remaining_amount", (o) => o.shipperRemainingAmount],
    ["shipper_remaining_percentage", (o) => o.shipperRemainingPercentage],
    ["shipper_full_payment_date::timestamp", (o) => o.shipperFullPaymentDate],
    ["number_mechanical_failures_stops", (o) => o.numberOfMechanicalFailuresStops],
    ["total_mechanical_failures_delayed_days", (o) => o.totalMechanicalFailuresDelayedDays],
    ["number_documentation_issues_stops", (o) => o.numberOfDocumentationIssuesStops],
    ["total_documentation_issues_delayed_days", (o) => o.totalDocumentationIssuesDelayedDays],
    ["number_police_stops", (o) => o.numberOfPoliceStops],
    ["total_police_delayed_days", (o) => o.totalPoliceDelayedDays],
    ["number_accidents", (o) => o.numberAccidents],
    ["cargo_damaged", (o) => o.cargoDamaged],
    ["damaged_percent", (o) => o.damagedPercent],
    ["claimed", (o) => o.claimed],
    ["age_factor", (o) => o.ageFactor],
    ["load_factor", (o) => o.loadFactor],
    ["default_coefficient", (o) => o.defaultCoefficient],
    ["created_at::timestamp", (o) => o.createdAt],
];

console.log("inserting orders...");
{
    const names = ORDER_COLUMNS.map(([name]) => name.split("::")[0]);
    const casts = ORDER_COLUMNS.map(([name]) => (name.includes("::") ? `::${name.split("::")[1]}` : ""));
    let inserted = 0;
    for (let start = 0; start < orders.length; start += 100) {
        const batch = orders.slice(start, start + 100);
        const params = [];
        const tuples = batch.map((order) => {
            const placeholders = ORDER_COLUMNS.map(([, get], index) => {
                params.push(get(order));
                return `$${params.length}${casts[index]}`;
            });
            return `(${placeholders.join(", ")})`;
        });
        await q(`INSERT INTO "order" (${names.join(", ")}) VALUES ${tuples.join(", ")}`, params);
        inserted += batch.length;
        process.stdout.write(`\r  ${inserted}/${orders.length}`);
    }
    console.log("");
}

/**
 * Report
 */
function report() {
    const pct = (n) => `${((n / Math.max(1, orders.length)) * 100).toFixed(0)}%`;

    console.log("\n--- order ids ---");
    console.log(`  kept from the sheet            ${stats.orderIdKept}`);
    console.log(`  bare sequence number -> APPL   ${stats.orderIdFromSequence}`);
    console.log(`  synthesized (row had no id)    ${stats.orderIdSynthesized}`);
    console.log(`  re-numbered (id already used)  ${stats.orderIdDeduped}`);

    console.log("\n--- filled in ---");
    console.log(`  distance      sheet ${stats.distanceFromSheet}  measured ${stats.distanceMeasured} (${pct(stats.distanceMeasured)})  still missing ${stats.distanceMissing}`);
    console.log(`  route         from geocoded countries ${stats.routeFromCountries}  from sheet ${stats.routeFromSheet}`);
    console.log(`  trip type     sheet ${stats.tripTypeFromSheet}  same route elsewhere ${stats.tripTypeFromRoute}  defaulted to normal ${stats.tripTypeDefaulted}`);
    console.log(`  load type     sheet ${stats.loadTypeFromSheet}  same route elsewhere ${stats.loadTypeFromRoute}  from weight ${stats.loadTypeFromWeight}  defaulted ${stats.loadTypeDefaulted}`);
    console.log(`  category      sheet ${stats.categoryFromSheet}  from description ${stats.categoryFromDescription}  defaulted to other ${stats.categoryDefaulted}`);
    console.log(`  POD status    sheet ${stats.podFromSheet}  from order status ${stats.podDerived}  none applicable ${stats.podNone}`);
    console.log(`  truck age     sheet ${stats.truckAgeFromSheet}  from the same plate ${stats.truckAgeFromPlate}  unknown ${stats.truckAgeMissing}`);
    console.log(`  offloading    sheet ${stats.offloadingDateFromSheet}  estimated from distance ${stats.offloadingDateEstimated}`);
    console.log(`  weight unit   defaulted to ton ${stats.weightUnitDefaulted}`);
    console.log(`  status        blank -> prospect ${stats.statusDefaulted}`);

    console.log("\n--- addresses ---");
    console.log(`  geocoded (placeId set)  ${stats.addressGeocoded}`);
    console.log(`  text only, no match     ${stats.addressUnresolved}`);
    console.log(`  unknown                 ${stats.addressUnknown}`);
    console.log(`  inferred from the shipper's only route  ${stats.addressInferred}`);

    if (stats.negativeTravelDays) {
        console.log(`\n${stats.negativeTravelDays} rows had a negative "Days Spend Traveling" in the sheet — recomputed from the loading and offloading dates instead`);
    }

    if (inconsistent.length) {
        console.log(`\n--- rows to fix in the logbook (${inconsistent.length}) ---`);
        for (const line of inconsistent) console.log(`  ${line}`);
    }

    if (mergedPlates) console.log(`\n${mergedPlates} alternate plate spellings merged onto the vehicle they name`);
    if (droppedPlates) console.log(`${droppedPlates} plate references dropped (the row named no carrier, so no fleet row could own them)`);

    if (warnings.length) {
        console.log(`\n--- warnings (${warnings.length}) ---`);
        for (const warning of warnings) console.log(`  ${warning}`);
    }
    if (skipped.length) {
        console.log(`\n--- skipped rows (${skipped.length}) ---`);
        for (const line of skipped) console.log(`  ${line}`);
    }
}

report();

/**
 * The wipe above truncates `organization`, which takes Appload's own row with
 * it — and a load handed to Appload names that row. Put it back.
 */
console.log("\nre-seeding the Appload organization...");
await seedAppload(sql);

const [{ n: orderCount }] = await q(`SELECT count(*)::int AS n FROM "order"`);
const [{ n: orgCount }] = await q(`SELECT count(*)::int AS n FROM organization`);
console.log(`\ndone: ${orderCount} orders, ${orgCount} organizations in ${databaseName}`);
