/**
 * Syncs carriers and shippers from the DATABASE LOGBOOK into the database.
 *
 * Reads the CARRIERS and SHIPPERS tabs and upserts one organization per row,
 * matched on type + name. Nothing is deleted and nothing is written back to
 * the spreadsheet, so the script can be re-run whenever the logbook changes.
 *
 * Rules:
 *  - a value the sheet states wins; a blank cell keeps what the database has
 *  - nuit, email and phone are NOT NULL + UNIQUE in the schema. A blank or
 *    unusable cell gets a stable, obviously synthetic placeholder
 *    ("MISSING-…", "missing-…@appload.invalid", "+000…") that the next run
 *    replaces once the sheet is filled. A value another organization already
 *    holds is reported and the row gets a placeholder for that field instead
 *    — the logbook, not the script, decides who the real owner is.
 *  - phones are stored E.164 the way the app dials them ("+258841234567")
 *  - addresses keep the sheet's own wording and are geocoded so the stored
 *    Location carries placeId / country / state like an app-registered one;
 *    lookups are cached in logbook-party-geocode-cache.json (additive)
 *  - the Representee column has no column of its own; it is kept in
 *    organization.metadata as {"representee": …}
 *
 * Usage:
 *   node packages/db/scripts/sync-parties-from-logbook.mjs [--db dev|prod] [--sheet dev|prod] [--dry] [--yes] [--out <dir>]
 *
 *   --db     database to write (default dev). prod reads apps/admin/.env.production.
 *   --sheet  logbook to read (default: same as --db). The prod sheet against the
 *            dev database is the rehearsal.
 *   --dry    plan and report only.
 *   --yes    actually write. Without it the script stops after the plan.
 *   --out    where the backup and report land (default: <tmp>/appload-logbook-sync).
 *   --prune  delete organizations that are no longer in the sheet — only those
 *            nothing references (no orders, fleet, drivers, members, KYC). The
 *            values they held are freed for the rows that remain in the same run.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";

import { loadEnv, googleAccessToken, getValues, sheetsGet } from "./google-sheets.mjs";
import { createGeocoder, countryCandidates } from "./google-geocode.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, "logbook-party-geocode-cache.json");

// ---------------------------------------------------------------------------
// Arguments and targets

const argValue = (name, fallback) => {
    const at = process.argv.indexOf(`--${name}`);
    const next = process.argv[at + 1];
    return at >= 0 && next && !next.startsWith("--") ? next : fallback;
};
const DRY = process.argv.includes("--dry");
const ASSUME_YES = process.argv.includes("--yes");
const RETRY_FAILED = process.argv.includes("--retry-failed");
const PRUNE = process.argv.includes("--prune");
const DB_TARGET = argValue("db", "dev");
const SHEET_TARGET = argValue("sheet", DB_TARGET);
const OUT_DIR = argValue("out", path.join(os.tmpdir(), "appload-logbook-sync"));

const ENV_FILES = {
    dev: path.resolve(__dirname, "../../../apps/admin/.env"),
    prod: path.resolve(__dirname, "../../../apps/admin/.env.production"),
};
for (const target of [DB_TARGET, SHEET_TARGET]) {
    if (!ENV_FILES[target]) throw new Error(`unknown target "${target}": use dev or prod`);
}

const dbEnv = loadEnv(ENV_FILES[DB_TARGET]);
const sheetEnv = loadEnv(ENV_FILES[SHEET_TARGET]);

const sql = neon(dbEnv.DATABASE_URL);
const q = (statement, params = []) => sql.query(statement, params);

/**
 * Safety rails: the database name and the spreadsheet title must both agree
 * with the target asked for, so a stale env file can never point a prod run
 * at dev or the other way round.
 */
const databaseName = decodeURIComponent(new URL(dbEnv.DATABASE_URL).pathname.slice(1)).split("?")[0];
if (DB_TARGET === "prod" ? !/prod/i.test(databaseName) : !/dev/i.test(databaseName)) {
    throw new Error(`refusing to run: DATABASE_URL names "${databaseName}", which is not a ${DB_TARGET} database`);
}

const spreadsheetId = sheetEnv.GOOGLE_SHEETS_ORDERS_SPREADSHEET_ID;
const token = await googleAccessToken(sheetEnv);
const meta = await sheetsGet(token, spreadsheetId, "?fields=properties.title");
const spreadsheetTitle = meta.properties.title;
const isDevSheet = /^dev\b/i.test(spreadsheetTitle);
if (SHEET_TARGET === "prod" ? isDevSheet || spreadsheetTitle !== "DATABASE LOGBOOK" : !isDevSheet) {
    throw new Error(`refusing to run: spreadsheet "${spreadsheetTitle}" is not the ${SHEET_TARGET} logbook`);
}

console.log(`database:    ${databaseName} (${DB_TARGET})`);
console.log(`spreadsheet: ${spreadsheetTitle} (${spreadsheetId}, ${SHEET_TARGET})`);
console.log(DRY ? "mode:        DRY RUN — nothing is written\n" : "mode:        WRITE\n");

// ---------------------------------------------------------------------------
// Helpers

const norm = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const key = (value) => norm(value).toLowerCase();

// Same recipe as the app's register mutation, so imported slugs look like
// registered ones
const slugify = (value) =>
    norm(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const digest = (seed) => crypto.createHash("sha1").update(seed).digest("hex");

/**
 * Placeholders for the NOT NULL unique columns. Derived from the organization
 * identity so they are stable across runs, and shaped so the partners search
 * finds them all with the word "missing".
 */
const placeholderFor = (type, name) => {
    const hash = digest(`${type}:${key(name)}`);
    return {
        nuit: `MISSING-${hash.slice(0, 8).toUpperCase()}`,
        email: `missing-${hash.slice(0, 8)}@appload.invalid`,
        phone: `+000${String(parseInt(hash.slice(0, 12), 16) % 1_000_000_000).padStart(9, "0")}`,
    };
};

/** Mozambican NUITs are nine digits; the sheet holds nothing else in the column. */
function normalizeNuit(raw) {
    const value = norm(raw);
    if (!value) return { value: null };
    const digits = value.replace(/\D/g, "");
    if (/^\d{9}$/.test(digits) && digits === value.replace(/\s/g, "")) return { value: digits };
    return { value: null, problem: `NUIT "${value}" is not 9 digits` };
}

function normalizeEmail(raw) {
    const value = norm(raw).toLowerCase();
    if (!value) return { value: null };
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { value };
    return { value: null, problem: `email "${norm(raw)}" is not an address` };
}

// Dial code -> full E.164 digit count for the countries the logbook holds,
// so a number with a stray digit is noticed rather than stored silently
const KNOWN_LENGTHS = { 258: 12, 27: 11, 268: 11, 267: 11, 260: 12, 263: 12, 265: 12, 255: 12, 234: 13, 254: 12, 372: 11 };

/**
 * E.164, the way the app's toE164 composes it. Sheets stores many cells as
 * bare numbers, which drops the "+": a bare 11+ digit run is taken as
 * already carrying its country code; 8-9 digits are a Mozambican number.
 */
function normalizePhone(raw) {
    const value = norm(raw);
    if (!value) return { value: null };

    const international = /^(\+|00)/.test(value);
    let digits = value.replace(/\D/g, "");
    if (value.startsWith("00")) digits = digits.slice(2);
    let note = null;

    if (!international) {
        if (digits.length >= 11) {
            // country code present, "+" lost to the cell's number format
        } else if (digits.length === 10 && digits.startsWith("0")) {
            digits = `258${digits.slice(1)}`;
            note = "read as a Mozambican number";
        } else if (digits.length === 8 || digits.length === 9) {
            digits = `258${digits}`;
            note = "read as a Mozambican number";
        } else {
            return { value: null, problem: `phone "${value}" is not a usable number` };
        }
    }

    const dial = Object.keys(KNOWN_LENGTHS).find((code) => digits.startsWith(code));
    if (dial) {
        const expected = KNOWN_LENGTHS[dial];
        // Trunk zero typed after the country code ("255 0753 …")
        if (digits.length === expected + 1 && digits[dial.length] === "0") {
            digits = dial + digits.slice(dial.length + 1);
            note = "dropped the trunk zero";
        } else if (digits.length !== expected) {
            note = `unexpected length for a +${dial} number`;
        }
    }

    if (digits.length < 10 || digits.length > 15) return { value: null, problem: `phone "${value}" has ${digits.length} digits` };
    return { value: `+${digits}`, note };
}

// ---------------------------------------------------------------------------
// Sheet

const TABS = [
    { tab: "CARRIERS", type: "carrier", nameHeaders: ["Carrier Name", "Carrier", "Name"] },
    { tab: "SHIPPERS", type: "shipper", nameHeaders: ["Shipper Name", "Shipper", "Name"] },
];
// Accepted spellings per field. Headers are matched on letters and digits
// only, so "Phone Number", "PhoneNumber" and "phone_number" are one header.
const FIELD_HEADERS = {
    nuit: ["NUIT"],
    representee: ["Representee", "Representative", "Contact Person"],
    phone: ["Phone Number", "Phone", "Telephone", "Mobile", "Contact"],
    email: ["Email", "E-mail"],
    billing: ["Billing Address"],
    physical: ["Physical Address", "Address"],
};
const FIELDS = Object.keys(FIELD_HEADERS);

const squash = (header) => String(header ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Header row -> { field: column index }, first matching spelling wins. */
function resolvePositions(headerRow, nameHeaders) {
    const index = new Map();
    headerRow.forEach((header, position) => {
        const k = squash(header);
        if (k && !index.has(k)) index.set(k, position);
    });
    const find = (spellings) => spellings.map(squash).map((k) => index.get(k)).find((position) => position !== undefined);
    const positions = { name: find(nameHeaders) };
    for (const field of FIELDS) positions[field] = find(FIELD_HEADERS[field]);
    const missing = Object.entries(positions)
        .filter(([, position]) => position === undefined)
        .map(([field]) => `${field} (${(field === "name" ? nameHeaders : FIELD_HEADERS[field]).join(" / ")})`);
    return { positions, missing };
}

const issues = []; // things the logbook should fix
const notes = []; // assumptions made while reading

const records = [];
for (const { tab, type, nameHeaders } of TABS) {
    const values = await getValues(token, spreadsheetId, tab, "A1:Z5000", "?valueRenderOption=UNFORMATTED_VALUE");
    const { positions, missing } = resolvePositions(values[0] ?? [], nameHeaders);
    if (missing.length) throw new Error(`${tab} is missing columns: ${missing.join(", ")}`);
    const cell = (row, field) => row[positions[field]];

    const byName = new Map();
    values.slice(1).forEach((row, index) => {
        const name = norm(cell(row, "name"));
        if (!name) return;
        const record = { sheetRow: index + 2, tab, type, name };
        for (const field of FIELDS) record[field] = norm(cell(row, field));

        // The same company typed twice: one organization, first value wins
        // per field, and the sheet is told
        const existing = byName.get(key(name));
        if (existing) {
            const merged = [];
            for (const field of FIELDS) {
                if (!existing[field] && record[field]) {
                    existing[field] = record[field];
                    merged.push(field);
                } else if (existing[field] && record[field] && key(existing[field]) !== key(record[field])) {
                    issues.push(`${tab} row ${record.sheetRow} "${name}": duplicate of row ${existing.sheetRow}, ${field} differs ("${record[field]}" vs "${existing[field]}") — row ${existing.sheetRow} kept`);
                }
            }
            issues.push(`${tab} row ${record.sheetRow} "${name}": duplicate of row ${existing.sheetRow}${merged.length ? ` (took ${merged.join(", ")} from it)` : ""}`);
            return;
        }
        byName.set(key(name), record);
    });

    records.push(...byName.values());
    console.log(`${tab}: ${byName.size} ${type}s read`);
}

// ---------------------------------------------------------------------------
// Geocode

const geocoder = createGeocoder(sheetEnv.GOOGLE_MAPS_API_KEY);
const cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) : { addresses: {} };
const saveCache = () => fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));

const COUNTRY_LABEL = {
    MZ: "Mozambique", ZA: "South Africa", ZW: "Zimbabwe", ZM: "Zambia", MW: "Malawi", TZ: "Tanzania",
    SZ: "Eswatini", BW: "Botswana", KE: "Kenya", NG: "Nigeria", ET: "Ethiopia", IN: "India", EE: "Estonia",
};
const NAMES_A_COUNTRY = /mo[cç]ambique|mozambique|south africa|africa do sul|zimbab|zambia|malawi|tan[sz]ania|eswatini|swazi|botswana|kenya|nigeria|ethiopia|india|estonia/i;

const distinctAddresses = new Map(); // key -> first spelling
for (const record of records) {
    for (const text of [record.billing, record.physical]) {
        if (text && !distinctAddresses.has(key(text))) distinctAddresses.set(key(text), text);
    }
}

let lookedUp = 0;
for (const [k, text] of distinctAddresses) {
    const cached = cache.addresses[k];
    if (cached?.ok || (cached && !RETRY_FAILED)) continue;
    cache.addresses[k] = await geocoder.geocode(text);
    lookedUp++;
    if (lookedUp % 25 === 0) {
        saveCache();
        console.log(`  ...${lookedUp} addresses geocoded`);
    }
}
saveCache();
console.log(`${distinctAddresses.size} distinct addresses, ${lookedUp} newly geocoded\n`);

const geocodeStats = { resolved: 0, weak: 0, failed: 0 };

/**
 * The stored Location keeps the sheet's wording as its address (the logbook
 * often knows the bairro and parcel that Google does not) and takes the
 * structured parts from the geocode. `state` is the town where one resolved,
 * which is what the app's location picker stores and what the partners list
 * labels each organization by.
 */
function locate(text) {
    const entry = cache.addresses[key(text)];
    if (entry?.ok) {
        if (entry.weak) geocodeStats.weak++;
        else geocodeStats.resolved++;
        const parts = entry.components ?? {};
        return {
            address: text,
            placeId: entry.location.placeId,
            country: entry.location.country,
            state: entry.weak ? "" : parts.locality || parts.admin2 || parts.admin1 || entry.location.state || "",
        };
    }
    geocodeStats.failed++;
    const [candidate] = countryCandidates(text);
    return { address: text, placeId: "", country: NAMES_A_COUNTRY.test(text) ? COUNTRY_LABEL[candidate] ?? "" : "", state: "" };
}

// ---------------------------------------------------------------------------
// Database state

const allRows = await q(
    `SELECT id, name, slug, type, nuit, email, phone_number, billing_address, physical_address, metadata FROM organization ORDER BY type, name`,
);
console.log(`${allRows.length} organizations already in the database`);

const inSheet = new Set(records.map((record) => `${record.type}:${key(record.name)}`));
const onlyInDatabase = allRows.filter((row) => !inSheet.has(`${row.type}:${key(row.name)}`));

/**
 * Rows the sheet dropped. Deleted only under --prune, and only when nothing
 * hangs off them: an organization with orders, fleet, drivers, members or
 * KYC documents is kept and listed, since removing it would take history
 * with it. Whatever the deleted rows held (an email, a phone) is left out of
 * the registry below so the surviving row can take it in this same run.
 */
const deletions = [];
const keptDespiteMissing = [];
if (PRUNE && onlyInDatabase.length) {
    const dependents = await q(
        `SELECT o.id,
            (SELECT count(*) FROM "order" WHERE shipper_id = o.id OR carrier_id = o.id)::int AS orders,
            (SELECT count(*) FROM network WHERE shipper_id = o.id OR carrier_id = o.id)::int AS network,
            (SELECT count(*) FROM member WHERE organization_id = o.id)::int AS members,
            (SELECT count(*) FROM invitation WHERE organization_id = o.id)::int AS invitations,
            (SELECT count(*) FROM kyc WHERE organization_id = o.id)::int AS kyc,
            (SELECT count(*) FROM kyc_document WHERE subject_type = 'organization' AND subject_id = o.id)::int AS documents,
            ((SELECT count(*) FROM truck WHERE carrier_id = o.id) + (SELECT count(*) FROM trailer WHERE carrier_id = o.id) + (SELECT count(*) FROM link WHERE carrier_id = o.id))::int AS vehicles,
            (SELECT count(*) FROM driver WHERE carrier_id = o.id)::int AS drivers
        FROM organization o WHERE o.id = ANY($1)`,
        [onlyInDatabase.map((row) => row.id)],
    );
    const usage = new Map(dependents.map((row) => [row.id, row]));
    for (const row of onlyInDatabase) {
        const use = usage.get(row.id) ?? {};
        const holds = Object.entries(use)
            .filter(([field, count]) => field !== "id" && Number(count) > 0)
            .map(([field, count]) => `${count} ${field}`);
        if (holds.length) keptDespiteMissing.push({ row, reason: holds.join(", ") });
        else deletions.push(row);
    }
}
const pruned = new Set(deletions.map((row) => row.id));
const existingRows = allRows.filter((row) => !pruned.has(row.id));
const existingByKey = new Map(existingRows.map((row) => [`${row.type}:${key(row.name)}`, row]));
if (PRUNE) console.log(`${deletions.length} to delete, ${keptDespiteMissing.length} kept despite missing from the sheet`);
console.log("");

/**
 * Uniqueness registry, seeded with everything the database holds so a
 * sheet value another organization already owns is caught before the
 * INSERT does. Owners keep what they have: a row's own values are released
 * only when that row is processed, and it reclaims them first.
 */
const registry = { nuit: new Map(), email: new Map(), phone: new Map(), slug: new Map() };
const labelOf = (row) => `${row.name} (${row.type})`;
const COLUMN = { nuit: "nuit", email: "email", phone: "phone_number", slug: "slug" };
for (const row of existingRows) {
    for (const field of Object.keys(COLUMN)) registry[field].set(row[COLUMN[field]], labelOf(row));
}
const release = (row) => {
    for (const field of Object.keys(COLUMN)) {
        if (registry[field].get(row[COLUMN[field]]) === labelOf(row)) registry[field].delete(row[COLUMN[field]]);
    }
};
/** Returns the other holder's label when the value is taken, null when claimed. */
const claim = (field, value, owner) => {
    const holder = registry[field].get(value);
    if (holder && holder !== owner) return holder;
    registry[field].set(value, owner);
    return null;
};

// ---------------------------------------------------------------------------
// Plan

const inserts = [];
const updates = [];
const conflicts = [];
const stats = {
    placeholders: { nuit: 0, email: 0, phone: 0 },
    fromSheet: { nuit: 0, email: 0, phone: 0, billing: 0, physical: 0, representee: 0 },
    unchanged: 0,
};

for (const record of records) {
    const owner = `${record.name} (${record.type})`;
    const existing = existingByKey.get(`${record.type}:${key(record.name)}`) ?? null;
    if (existing) release(existing);

    const placeholder = placeholderFor(record.type, record.name);
    const desired = {};

    for (const [field, normalize] of [["nuit", normalizeNuit], ["email", normalizeEmail], ["phone", normalizePhone]]) {
        const parsed = normalize(record[field]);
        if (parsed.problem) issues.push(`${record.tab} row ${record.sheetRow} "${record.name}": ${parsed.problem}`);
        if (parsed.note) notes.push(`${record.tab} row ${record.sheetRow} "${record.name}": phone "${record.phone}" -> ${parsed.value} (${parsed.note})`);

        const current = existing?.[COLUMN[field]] ?? null;
        let value = parsed.value ?? current;
        if (parsed.value) stats.fromSheet[field]++;

        if (value) {
            const holder = claim(field, value, owner);
            if (holder) {
                conflicts.push(`${record.tab} row ${record.sheetRow} "${record.name}": ${field} ${value} already belongs to ${holder}`);
                // Fall back to what the row already holds, if that is still free
                value = current && current !== value && !claim(field, current, owner) ? current : null;
            }
        }
        if (!value) {
            value = placeholder[field];
            for (let bump = 2; claim(field, value, owner); bump++) value = `${placeholder[field]}-${bump}`;
            stats.placeholders[field]++;
        }
        desired[field] = value;
    }

    desired.billing = record.billing ? locate(record.billing) : existing?.billing_address ?? null;
    desired.physical = record.physical ? locate(record.physical) : existing?.physical_address ?? null;
    if (record.billing) stats.fromSheet.billing++;
    if (record.physical) stats.fromSheet.physical++;

    let metadata = {};
    try {
        metadata = existing?.metadata ? JSON.parse(existing.metadata) : {};
    } catch {
        metadata = {};
    }
    if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) metadata = {};
    if (record.representee) {
        metadata.representee = record.representee;
        stats.fromSheet.representee++;
    }
    desired.metadata = Object.keys(metadata).length ? JSON.stringify(metadata) : existing?.metadata ?? null;

    if (existing) {
        claim("slug", existing.slug, owner);
        // jsonb hands keys back in its own order, so compare on sorted keys
        const canonical = (value) =>
            value ? JSON.stringify(Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]]))) : null;
        const same = (a, b) => canonical(a) === canonical(b);
        const changes = [];
        if (desired.nuit !== existing.nuit) changes.push(["nuit", existing.nuit, desired.nuit]);
        if (desired.email !== existing.email) changes.push(["email", existing.email, desired.email]);
        if (desired.phone !== existing.phone_number) changes.push(["phone_number", existing.phone_number, desired.phone]);
        if (!same(desired.billing, existing.billing_address)) changes.push(["billing_address", existing.billing_address?.address ?? null, desired.billing?.address ?? null]);
        if (!same(desired.physical, existing.physical_address)) changes.push(["physical_address", existing.physical_address?.address ?? null, desired.physical?.address ?? null]);
        if ((desired.metadata ?? null) !== (existing.metadata ?? null)) changes.push(["metadata", existing.metadata, desired.metadata]);
        if (changes.length) updates.push({ id: existing.id, name: record.name, type: record.type, desired, changes });
        else stats.unchanged++;
        continue;
    }

    const base = slugify(record.name) || "organization";
    let slug = base;
    if (claim("slug", slug, owner)) {
        slug = `${base}-${record.type}`;
        for (let bump = 2; claim("slug", slug, owner); bump++) slug = `${base}-${record.type}-${bump}`;
    }
    inserts.push({ id: crypto.randomUUID(), name: record.name, type: record.type, slug, desired });
}

// ---------------------------------------------------------------------------
// Report

fs.mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = path.join(OUT_DIR, `parties-${DB_TARGET}-${stamp}.md`);

const countBy = (list, type) => list.filter((item) => item.type === type).length;
const summary = [
    `sheet rows:        ${records.length} (${countBy(records, "carrier")} carriers, ${countBy(records, "shipper")} shippers)`,
    `to insert:         ${inserts.length} (${countBy(inserts, "carrier")} carriers, ${countBy(inserts, "shipper")} shippers)`,
    `to update:         ${updates.length}`,
    `unchanged:         ${stats.unchanged}`,
    PRUNE
        ? `to delete:         ${deletions.length} (${keptDespiteMissing.length} kept: still referenced)`
        : `only in database:  ${onlyInDatabase.length} (left alone; --prune deletes them)`,
    ``,
    `from the sheet:    nuit ${stats.fromSheet.nuit}, email ${stats.fromSheet.email}, phone ${stats.fromSheet.phone}, billing ${stats.fromSheet.billing}, physical ${stats.fromSheet.physical}, representee ${stats.fromSheet.representee}`,
    `placeholders:      nuit ${stats.placeholders.nuit}, email ${stats.placeholders.email}, phone ${stats.placeholders.phone}`,
    `addresses:         ${geocodeStats.resolved} resolved, ${geocodeStats.weak} country only, ${geocodeStats.failed} not found`,
    `sheet issues:      ${issues.length}`,
    `value conflicts:   ${conflicts.length}`,
    `phone assumptions: ${notes.length}`,
];

const section = (title, lines) => (lines.length ? [`## ${title} (${lines.length})`, "", ...lines.map((line) => `- ${line}`), ""] : []);
const failedAddresses = [...distinctAddresses.values()].filter((text) => !cache.addresses[key(text)]?.ok);
const weakAddresses = [...distinctAddresses.values()].filter((text) => cache.addresses[key(text)]?.weak);
const report = [
    `# Logbook parties -> ${databaseName}`,
    ``,
    `spreadsheet: ${spreadsheetTitle} (${spreadsheetId})`,
    `run: ${new Date().toISOString()} ${DRY ? "(dry run)" : ""}`,
    ``,
    "```",
    ...summary,
    "```",
    ``,
    ...section("Sheet issues — values the logbook should fix", issues),
    ...section("Conflicts — value already held by another organization, placeholder used", conflicts),
    ...section("Phone assumptions", notes),
    ...section("Addresses Google could not find (stored without placeId)", failedAddresses),
    ...section("Addresses resolved to a country only", weakAddresses),
    ...section("Updates", updates.map((u) => `${u.name} (${u.type}): ${u.changes.map(([field, from, to]) => `${field} "${from ?? ""}" -> "${to ?? ""}"`).join("; ")}`)),
    ...section("Inserts", inserts.map((i) => `${i.name} (${i.type}) nuit=${i.desired.nuit} email=${i.desired.email} phone=${i.desired.phone}`)),
    ...section("Deletions — dropped from the sheet, nothing references them", deletions.map((row) => `${row.name} (${row.type}) nuit=${row.nuit} email=${row.email} phone=${row.phone_number}`)),
    ...section("Kept although missing from the sheet — still referenced", keptDespiteMissing.map(({ row, reason }) => `${row.name} (${row.type}): ${reason}`)),
    ...(PRUNE ? [] : section("Only in the database", onlyInDatabase.map((row) => `${row.name} (${row.type})`))),
].join("\n");
fs.writeFileSync(reportPath, report);

console.log(summary.join("\n"));
const preview = (title, lines, limit = 15) => {
    if (!lines.length) return;
    console.log(`\n${title}:`);
    for (const line of lines.slice(0, limit)) console.log(`  ${line}`);
    if (lines.length > limit) console.log(`  ... ${lines.length - limit} more in the report`);
};
preview("sheet issues", issues);
preview("conflicts", conflicts);
preview("addresses not found", failedAddresses);
preview("updates", updates.map((u) => `${u.name} (${u.type}): ${u.changes.map(([field]) => field).join(", ")}`));
preview("deletions", deletions.map((row) => `${row.name} (${row.type})`));
preview("kept although missing from the sheet", keptDespiteMissing.map(({ row, reason }) => `${row.name} (${row.type}): ${reason}`));
console.log(`\nreport: ${reportPath}`);

if (DRY) process.exit(0);

if (!ASSUME_YES) {
    console.log(`\nThis writes ${inserts.length} inserts, ${updates.length} updates and ${deletions.length} deletions to ${databaseName}.`);
    console.log("Re-run with --yes to proceed.");
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Write

const backupPath = path.join(OUT_DIR, `organization-${DB_TARGET}-${stamp}.backup.json`);
const backup = await q(`SELECT * FROM organization ORDER BY type, name`);
fs.writeFileSync(backupPath, JSON.stringify(backup, null, 1));
console.log(`\nbackup: ${backupPath} (${backup.length} rows)`);

const json = (value) => (value === null || value === undefined ? null : JSON.stringify(value));
const INSERT_COLUMNS = "id, name, slug, created_at, metadata, nuit, type, status, email, phone_number, billing_address, physical_address";
const insertValues = (row) => [
    row.id, row.name, row.slug, new Date().toISOString(), row.desired.metadata, row.desired.nuit, row.type, "active",
    row.desired.email, row.desired.phone, json(row.desired.billing), json(row.desired.physical),
];
const failures = [];

// Deletions go first so the values they held are free before the inserts
// and updates that were planned to take them
if (deletions.length) {
    console.log(`deleting ${deletions.length}...`);
    try {
        await q(`DELETE FROM organization WHERE id = ANY($1)`, [deletions.map((row) => row.id)]);
    } catch (error) {
        failures.push(`delete ${deletions.length} organizations: ${error.message}`);
    }
}

console.log(`inserting ${inserts.length}...`);
const BATCH = 100;
for (let start = 0; start < inserts.length; start += BATCH) {
    const batch = inserts.slice(start, start + BATCH);
    const params = [];
    const tuples = batch.map((row) => `(${insertValues(row).map((value) => { params.push(value); return `$${params.length}`; }).join(", ")})`);
    try {
        await q(`INSERT INTO organization (${INSERT_COLUMNS}) VALUES ${tuples.join(", ")}`, params);
    } catch {
        // One at a time, so a single bad row does not sink its batch
        for (const row of batch) {
            try {
                await q(`INSERT INTO organization (${INSERT_COLUMNS}) VALUES (${insertValues(row).map((_, i) => `$${i + 1}`).join(", ")})`, insertValues(row));
            } catch (error) {
                failures.push(`insert ${row.name} (${row.type}): ${error.message}`);
            }
        }
    }
}

console.log(`updating ${updates.length}...`);
for (const update of updates) {
    try {
        await q(
            `UPDATE organization SET nuit = $1, email = $2, phone_number = $3, billing_address = $4, physical_address = $5, metadata = $6 WHERE id = $7`,
            [update.desired.nuit, update.desired.email, update.desired.phone, json(update.desired.billing), json(update.desired.physical), update.desired.metadata, update.id],
        );
    } catch (error) {
        failures.push(`update ${update.name} (${update.type}): ${error.message}`);
    }
}

const after = await q(`SELECT type, count(*)::int AS n FROM organization GROUP BY type ORDER BY type`);
console.log(`\ndone. organizations now: ${after.map((row) => `${row.n} ${row.type}s`).join(", ")}`);
if (failures.length) {
    console.log(`\n${failures.length} statements failed:`);
    for (const failure of failures) console.log(`  ${failure}`);
    fs.appendFileSync(reportPath, ["", `## Failed statements (${failures.length})`, "", ...failures.map((line) => `- ${line}`), ""].join("\n"));
    process.exit(1);
}
