/**
 * One-off seeder: clones the orders Google Sheet into the database so the
 * UI can be tested against real data.
 *
 * Reads CSV exports of the ALL ORDERS, ACCOUNTING and RATINGS tabs (the
 * ACCOUNTING/RATINGS tabs are formula spills of ALL ORDERS — only their
 * hand-entered columns are read), geocodes the loading/offloading
 * addresses through the Google Maps Geocoding API to fill the Location
 * jsonb ({ address, placeId, country, state }), creates missing
 * shipper/carrier organizations, and upserts `order` rows by order_id.
 *
 * Truck/trailer/link plates are NOT imported (they are FKs into fleet
 * tables that would need synthetic rows).
 *
 * Usage:
 *   node packages/db/scripts/import-orders-sheet.mjs \
 *     --all-orders <csv> --accounting <csv> --ratings <csv> \
 *     --cache <geocode-cache.json> [--dry]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Env + args
 */
function loadEnv() {
    const envPath = path.resolve(__dirname, "../../../apps/admin/.env");
    const out = {};
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (match) out[match[1]] = match[2];
    }
    return out;
}

function arg(name, fallback = undefined) {
    const index = process.argv.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const value = process.argv[index + 1];
    return value && !value.startsWith("--") ? value : true;
}

const DRY = process.argv.includes("--dry");
const env = loadEnv();

if (!env.DATABASE_URL) throw new Error("DATABASE_URL missing from apps/admin/.env");
if (!env.GOOGLE_MAPS_API_KEY) throw new Error("GOOGLE_MAPS_API_KEY missing from apps/admin/.env");

const sql = neon(env.DATABASE_URL);
const q = (text, params = []) => (typeof sql.query === "function" ? sql.query(text, params) : sql(text, params));

/**
 * CSV parsing (quotes, embedded commas/newlines)
 */
function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { cell += '"'; i++; }
                else inQuotes = false;
            } else cell += ch;
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ",") {
            row.push(cell); cell = "";
        } else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && text[i + 1] === "\n") i++;
            row.push(cell); cell = "";
            rows.push(row); row = [];
        } else {
            cell += ch;
        }
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

const readCsv = (file) => parseCsv(fs.readFileSync(file, "utf8"));

/**
 * Value parsing + reverse label maps (sheet labels are mixed EN/PT)
 */
const norm = (value) => (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const textOrNull = (value) => {
    const trimmed = (value ?? "").trim();
    return trimmed === "" ? null : trimmed;
};

const money = (value) => {
    const cleaned = (value ?? "").replace(/[,\s]/g, "");
    if (cleaned === "") return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : null;
};

const int = (value) => {
    const cleaned = (value ?? "").replace(/[,\s]/g, "").replace(/km$/i, "");
    if (cleaned === "") return null;
    const parsed = Number(cleaned);
    return Number.isInteger(parsed) ? parsed : Number.isFinite(parsed) ? Math.round(parsed) : null;
};

const weight = (value) => {
    const cleaned = (value ?? "").replace(/[,\s]/g, "");
    if (cleaned === "") return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed.toFixed(3) : null;
};

const percent = (value) => {
    const cleaned = (value ?? "").replace(/[%\s]/g, "").replace(",", ".");
    if (cleaned === "") return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? String(parsed) : null;
};

// Sheet dates are English: "9 January 2026", "06 Jan 2026", "30 Dec 2025"
const date = (value) => {
    const trimmed = (value ?? "").trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const yesNo = (value) => {
    const n = norm(value);
    return n === "yes" ? true : n === "no" ? false : null;
};

const mapWith = (aliases, fallback = null) => (value) => aliases[norm(value)] ?? fallback;

const status = mapWith({
    "prospect": "prospect", "prospects": "prospect",
    "booked": "booked",
    "to loading": "to-loading",
    "at loading": "at-loading",
    "loading": "loading",
    "waiting for documents": "waiting-documents", "waiting documents": "waiting-documents",
    "on route": "on-route", "in transit": "on-route",
    "stopped": "stopped",
    "issue": "issue",
    "at border": "at-border",
    "at offloading": "at-offloading",
    "offloading": "offloading",
    "delivered": "delivered",
    "completed": "completed",
    "cancelled": "cancelled",
    "underbid": "underbid",
});

const category = mapWith({
    "agriculture inputs": "agriculture-inputs",
    "agriculture products": "agriculture-products",
    "fertilizers": "agriculture-inputs",
    "fertilizantes": "agriculture-inputs",
    "carga industrial": "general-cargo",
    "bottles": "general-cargo",
    "construção": "construction",
    "construction": "construction",
    "travessas de madeira": "construction",
    "fresh": "agriculture-products",
    "frozen fish": "agriculture-products",
    "machinery & equipment": "machinery-equipment",
    "fmcg": "fmcg",
    "general cargo": "general-cargo",
    "medicine": "medicine",
    "mining": "mining",
    "oil & gas": "oil-gas",
    "vehicles": "vehicles",
    "other": "other",
}, "other");

const loadType = mapWith({
    "dedicado": "dedicated", "dedicated truck": "dedicated", "dedicated": "dedicated",
    "grupagem": "groupage", "groupage": "groupage",
}, "dedicated");

const truckAge = mapWith({ "recent": "recent", "non recent": "not-recent", "not recent": "not-recent" });
const routeType = mapWith({ "national": "national", "regional": "regional" }, "national");
const tripType = mapWith({ "backload": "backload", "normal": "normal" }, "normal");
const podStatus = mapWith({
    "pending collection": "pending-collection",
    "pending delivery": "pending-delivery",
    "delivered": "delivered",
    "verified": "verified",
});
const fiscalRegime = mapWith({ "16%": "normal", "5%": "simplified-5", "3%": "simplified-3", "n/a": "n/a" });
const currency = mapWith({ "mzn": "MZN", "zar": "ZAR", "usd": "USD" });
const insuranceStatus = mapWith({ "pending": "pending", "paid": "paid", "not applicable": "not-applicable" });
const insuranceSubscriber = mapWith({ "appload": "appload", "shipper": "shipper" });
const paymentStatus = mapWith({
    "pending payment": "pending",
    "partially paid": "partially",
    "payment completed": "completed",
    "not appliable": "not-applicable",
    "not applicable": "not-applicable",
    // "Cancelled" has no DB counterpart — leave null
});

/**
 * Geocoding with a file cache
 */
const cachePath = arg("cache", path.join(__dirname, "geocode-cache.json"));
const geocodeCache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf8")) : {};
const geocodeFailures = [];

function fallbackLocation(raw) {
    const segments = raw.split(",").map((segment) => segment.trim()).filter(Boolean);
    return {
        address: raw,
        placeId: "",
        country: segments.length > 1 ? segments[segments.length - 1] : "",
        state: segments[0] ?? "",
    };
}

async function geocode(raw) {
    const key = norm(raw);
    if (geocodeCache[key]) return geocodeCache[key];

    let location = null;
    try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(raw)}&region=mz&key=${env.GOOGLE_MAPS_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        const result = data.status === "OK" ? data.results?.[0] : null;

        if (result) {
            const component = (type) =>
                result.address_components?.find((c) => c.types?.includes(type))?.long_name ?? "";
            location = {
                address: result.formatted_address ?? raw,
                placeId: result.place_id ?? "",
                country: component("country"),
                // Fall back through admin levels — MZ geocodes often carry
                // the province as level 1, cities as locality
                state: component("administrative_area_level_1") || component("locality") || "",
            };
        } else {
            geocodeFailures.push(`${raw} -> ${data.status}${data.error_message ? `: ${data.error_message}` : ""}`);
        }
    } catch (error) {
        geocodeFailures.push(`${raw} -> ${error.message}`);
    }

    location ??= fallbackLocation(raw);
    geocodeCache[key] = location;
    return location;
}

/**
 * Load sheets
 */
const allOrdersRows = readCsv(arg("all-orders"));
const accountingRows = readCsv(arg("accounting"));
const ratingsRows = readCsv(arg("ratings"));

const ORDER_ID_PATTERN = /^APPL(\d+)\.(\d{2})$/;

// ACCOUNTING manual columns by 0-based index
const accountingById = new Map();
for (const row of accountingRows.slice(1)) {
    const orderId = (row[0] ?? "").trim();
    if (!ORDER_ID_PATTERN.test(orderId)) continue;
    accountingById.set(orderId, {
        carrierInvoiceNumber: textOrNull(row[12]),
        carrierInvoiceDate: date(row[13]),
        carrierPaidAmount: money(row[20]),
        carrierPaymentStatus: paymentStatus(row[22]),
        carrierFullPaymentDate: date(row[25]),
        shipperInvoiceNumber: textOrNull(row[29]),
        shipperInvoiceDate: date(row[30]),
        shipperPaidAmount: money(row[36]),
        shipperPaymentStatus: paymentStatus(row[38]),
        shipperFullPaymentDate: date(row[41]),
    });
}

// RATINGS trip-performance columns by 0-based index (AB=27 … AS=44)
const ratingsById = new Map();
for (const row of ratingsRows.slice(1)) {
    const orderId = (row[0] ?? "").trim();
    if (!ORDER_ID_PATTERN.test(orderId)) continue;
    ratingsById.set(orderId, {
        arrivalOnTimeLoading: yesNo(row[27]),
        arrivalOnTimeOffloading: yesNo(row[28]),
        daysSpendLoading: int(row[29]),
        daysSpendTraveling: int(row[30]),
        daysSpendAtBorder: int(row[31]),
        daysSpendOffloading: int(row[32]),
        numberOfMechanicalFailuresStops: int(row[35]),
        totalMechanicalFailuresDelayedDays: int(row[36]),
        numberOfDocumentationIssuesStops: int(row[37]),
        totalDocumentationIssuesDelayedDays: int(row[38]),
        numberOfPoliceStops: int(row[39]),
        totalPoliceDelayedDays: int(row[40]),
        numberAccidents: int(row[41]),
        cargoDamaged: yesNo(row[42]),
        damagedPercent: percent(row[43]),
        claimed: yesNo(row[44]),
    });
}

/**
 * Organizations: reuse by (normalized name, type), create missing ones
 * with synthetic-but-unique contact fields (dev seeding only)
 */
const slugify = (name) =>
    norm(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "org";

const orgIds = new Map(); // `${type}:${norm(name)}` -> id
const createdOrgs = [];

async function ensureOrganization(name, type) {
    const key = `${type}:${norm(name)}`;
    if (orgIds.has(key)) return orgIds.get(key);

    const existing = await q(
        `SELECT id FROM organization WHERE lower(trim(name)) = $1 AND type = $2 LIMIT 1`,
        [norm(name), type],
    );
    if (existing.length) {
        orgIds.set(key, existing[0].id);
        return existing[0].id;
    }

    const id = randomUUID();
    const slug = `${slugify(name)}-${type}`;
    createdOrgs.push(`${name.trim()} (${type})`);

    if (!DRY) {
        await q(
            `INSERT INTO organization (id, name, slug, created_at, nuit, type, status, email, phone_number, subscription_plan)
             VALUES ($1, $2, $3, now(), $4, $5, 'active', $6, $7, 'free')
             ON CONFLICT (slug) DO NOTHING`,
            [id, name.trim(), slug, `IMP-${slug}`.slice(0, 30), type, `${slug}@import.appload.local`, `+258-imp-${slug}`.slice(0, 30)],
        );
        // Slug clash with a different name: reuse the row that owns the slug
        const [row] = await q(`SELECT id FROM organization WHERE slug = $1`, [slug]);
        orgIds.set(key, row.id);
        return row.id;
    }

    orgIds.set(key, id);
    return id;
}

/**
 * Order upsert
 */
// "id" has a Drizzle-side (not DB-side) uuid default, so raw SQL supplies it
const COLUMNS = [
    "id", "order_id", "seq", "year", "shipper_name", "shipper_id",
    "loading_address", "expected_loading_date", "offloading_address", "expected_offloading_date",
    "distance", "category", "description", "weight", "loaded_weight", "offloaded_weight", "weight_unit",
    "status", "route", "trip_type", "load_type", "deliveries", "pod_status",
    "carrier_name", "carrier_id", "driver_name", "driver_phone_number", "driver_passport", "truck_age",
    "deal_date", "fiscal_regime",
    "carrier_subtotal", "carrier_vat", "carrier_total", "carrier_currency",
    "insurance_subscriber", "insurance_value", "insurance_currency", "insurance_status",
    "appload_commission_subtotal", "appload_commission_vat", "appload_commission_total",
    "shipper_subtotal", "shipper_vat", "shipper_total", "shipper_currency",
    "carrier_invoice_number", "carrier_invoice_date", "carrier_paid_amount",
    "carrier_paid_percentage", "carrier_payment_status", "carrier_remaining_amount", "carrier_remaining_percentage", "carrier_full_payment_date",
    "shipper_invoice_number", "shipper_invoice_date", "shipper_received_amount",
    "shipper_received_percentage", "shipper_payment_status", "shipper_remaining_amount", "shipper_remaining_percentage", "shipper_full_payment_date",
    "arrival_ontime_loading", "arrival_ontime_offloading", "days_spend_loading", "days_spend_traveling",
    "days_spend_at_border", "days_spend_offloading",
    "number_mechanical_failures_stops", "total_mechanical_failures_delayed_days",
    "number_documentation_issues_stops", "total_documentation_issues_delayed_days",
    "number_police_stops", "total_police_delayed_days", "number_accidents",
    "cargo_damaged", "damaged_percent", "claimed",
    "created_at",
];

const JSONB_COLUMNS = new Set(["loading_address", "offloading_address"]);
const TIMESTAMP_COLUMNS = new Set([
    "expected_loading_date", "expected_offloading_date", "deal_date",
    "carrier_invoice_date", "carrier_full_payment_date",
    "shipper_invoice_date", "shipper_full_payment_date", "created_at",
]);

const UPSERT_SQL = `
    INSERT INTO "order" (${COLUMNS.join(", ")})
    VALUES (${COLUMNS.map((column, index) =>
        JSONB_COLUMNS.has(column) ? `$${index + 1}::jsonb`
            : TIMESTAMP_COLUMNS.has(column) ? `$${index + 1}::timestamp`
                : `$${index + 1}`).join(", ")})
    ON CONFLICT (order_id) DO UPDATE SET
        ${COLUMNS.filter((column) => column !== "order_id" && column !== "id").map((column) => `${column} = EXCLUDED.${column}`).join(", ")},
        updated_at = now()
`;

function derivedPayments(status, paidAmount, total) {
    // Same rules as the app: prospect => not-applicable, booked => pending;
    // completed forces 100/0/0; partial payments derive the percentages
    let paymentStatus = status ?? null;
    let paidPercentage = null;
    let remainingAmount = null;
    let remainingPercentage = null;

    if (paymentStatus === "completed") {
        paidPercentage = "100";
        remainingAmount = "0";
        remainingPercentage = "0";
    } else if (paidAmount !== null && total !== null && Number(total) > 0) {
        const ratio = (Number(paidAmount) / Number(total)) * 100;
        paidPercentage = String(Math.round(ratio * 100) / 100);
        remainingAmount = (Number(total) - Number(paidAmount)).toFixed(2);
        remainingPercentage = String(Math.round((100 - ratio) * 100) / 100);
    }

    return { paymentStatus, paidPercentage, remainingAmount, remainingPercentage };
}

const skipped = [];
const unknownCategories = new Map();
const unknownStatuses = new Map();
let imported = 0;

const dataRows = allOrdersRows.slice(1);

for (const row of dataRows) {
    const orderId = (row[0] ?? "").trim();
    const idMatch = orderId.match(ORDER_ID_PATTERN);
    if (!idMatch) {
        if (orderId) skipped.push(`${orderId}: order id doesn't match APPLnnn.yy`);
        continue;
    }

    const shipperName = textOrNull(row[1]);
    if (!shipperName) { skipped.push(`${orderId}: missing shipper`); continue; }

    const tripStatus = status(row[28]);
    if (!tripStatus) {
        unknownStatuses.set(row[28], (unknownStatuses.get(row[28]) ?? 0) + 1);
        skipped.push(`${orderId}: unmapped status "${row[28]}"`);
        continue;
    }

    // Prospect rows can legitimately have no dates yet; the column is NOT
    // NULL, so fall back to the import date
    const expectedLoadingDate = date(row[15]) ?? date(row[2]) ?? new Date().toISOString();

    const loadingRaw = textOrNull(row[14]);
    const offloadingRaw = textOrNull(row[17]);
    if (!loadingRaw || !offloadingRaw) { skipped.push(`${orderId}: missing address`); continue; }

    if (category(row[23]) === "other" && norm(row[23]) !== "" && norm(row[23]) !== "other") {
        unknownCategories.set(row[23].trim(), (unknownCategories.get(row[23].trim()) ?? 0) + 1);
    }

    const carrierName = textOrNull(row[31]);
    const shipperId = await ensureOrganization(shipperName, "shipper");
    const carrierId = carrierName ? await ensureOrganization(carrierName, "carrier") : null;

    const loadingAddress = await geocode(loadingRaw);
    const offloadingAddress = await geocode(offloadingRaw);

    const accounting = accountingById.get(orderId) ?? {};
    const ratings = ratingsById.get(orderId) ?? {};

    const loadedWeight = weight(row[25]);
    const offloadedWeight = weight(row[26]);
    const dealDate = date(row[2]);

    // The app's payment-status rule, applied when the sheet has no status
    const ruleStatus = tripStatus === "prospect" ? "not-applicable" : tripStatus === "booked" ? "pending" : null;
    const carrierTotal = money(row[35]);
    const shipperTotal = money(row[46]);

    const carrierPayments = derivedPayments(
        accounting.carrierPaymentStatus ?? ruleStatus,
        accounting.carrierPaidAmount, carrierTotal,
    );
    const shipperPayments = derivedPayments(
        accounting.shipperPaymentStatus ?? ruleStatus,
        accounting.shipperPaidAmount, shipperTotal,
    );

    const values = [
        randomUUID(), orderId, Number(idMatch[1]), 2000 + Number(idMatch[2]), shipperName, shipperId,
        JSON.stringify(loadingAddress), expectedLoadingDate, JSON.stringify(offloadingAddress), date(row[18]),
        int(row[19]), category(row[23]), textOrNull(row[24]) ?? "", loadedWeight ?? offloadedWeight ?? "0", loadedWeight, offloadedWeight, "ton",
        tripStatus, routeType(row[20]), tripType(row[21]), loadType(row[7]), int(row[27]) ?? 1, podStatus(row[29]),
        carrierName, carrierId, textOrNull(row[9]), textOrNull(row[10]), textOrNull(row[12]), truckAge(row[8]),
        dealDate, fiscalRegime(row[32]),
        money(row[33]), money(row[34]), carrierTotal, currency(row[36]) ?? "MZN",
        insuranceSubscriber(row[37]), money(row[38]), currency(row[39]), insuranceStatus(row[40]),
        money(row[41]), money(row[42]), money(row[43]),
        money(row[44]), money(row[45]), shipperTotal, currency(row[47]) ?? "MZN",
        accounting.carrierInvoiceNumber ?? null, accounting.carrierInvoiceDate ?? null, accounting.carrierPaidAmount ?? null,
        carrierPayments.paidPercentage, carrierPayments.paymentStatus, carrierPayments.remainingAmount, carrierPayments.remainingPercentage, accounting.carrierFullPaymentDate ?? null,
        accounting.shipperInvoiceNumber ?? null, accounting.shipperInvoiceDate ?? null, accounting.shipperPaidAmount ?? null,
        shipperPayments.paidPercentage, shipperPayments.paymentStatus, shipperPayments.remainingAmount, shipperPayments.remainingPercentage, accounting.shipperFullPaymentDate ?? null,
        ratings.arrivalOnTimeLoading ?? null, ratings.arrivalOnTimeOffloading ?? null, ratings.daysSpendLoading ?? null, ratings.daysSpendTraveling ?? null,
        ratings.daysSpendAtBorder ?? null, ratings.daysSpendOffloading ?? null,
        ratings.numberOfMechanicalFailuresStops ?? 0, ratings.totalMechanicalFailuresDelayedDays ?? null,
        ratings.numberOfDocumentationIssuesStops ?? 0, ratings.totalDocumentationIssuesDelayedDays ?? null,
        ratings.numberOfPoliceStops ?? 0, ratings.totalPoliceDelayedDays ?? null, ratings.numberAccidents ?? 0,
        ratings.cargoDamaged ?? false, ratings.damagedPercent ?? null, ratings.claimed ?? false,
        dealDate ?? expectedLoadingDate,
    ];

    if (values.length !== COLUMNS.length) {
        throw new Error(`Row ${orderId}: ${values.length} values for ${COLUMNS.length} columns`);
    }

    if (!DRY) {
        await q(UPSERT_SQL, values);
    }
    imported++;
}

fs.writeFileSync(cachePath, JSON.stringify(geocodeCache, null, 2));

/**
 * Report
 */
console.log(`${DRY ? "[DRY RUN] " : ""}Imported ${imported}/${dataRows.filter((row) => (row[0] ?? "").trim()).length} orders`);
console.log(`Organizations created: ${createdOrgs.length}`);
if (createdOrgs.length) console.log("  " + createdOrgs.join("\n  "));
if (skipped.length) {
    console.log(`Skipped ${skipped.length}:`);
    console.log("  " + skipped.join("\n  "));
}
if (unknownCategories.size) {
    console.log("Unmapped categories (imported as 'other'):");
    for (const [label, count] of unknownCategories) console.log(`  ${label} (${count})`);
}
if (unknownStatuses.size) {
    console.log("Unmapped statuses (rows skipped):");
    for (const [label, count] of unknownStatuses) console.log(`  "${label}" (${count})`);
}
if (geocodeFailures.length) {
    console.log(`Geocode fallbacks (${geocodeFailures.length}):`);
    console.log("  " + geocodeFailures.join("\n  "));
}
