/**
 * Fills the DATABASE LOGBOOK's TRUCKS, TRAILERS, LINKS and DRIVERS tabs from
 * its own ORDERS tab, as a starting point for a manual cleanup pass. Tabs
 * that do not exist yet are created; each unit type gets its own tab with
 * only the columns that apply to it.
 *
 * Everything here is aggregation, not invention:
 *   - A vehicle's identity is its plate's alphanumerics ("KR 92 SB GP" and
 *     "KR92SBGP" are one truck); the spelling used most often is written and
 *     the alternates are listed beside it so they can be fixed in ORDERS.
 *   - A truck is Articulated when at least one of its orders names a trailer
 *     or link plate, Non-articulated otherwise. Rigids that still carried
 *     heavy loads are flagged — the trailer plate was probably just never
 *     recorded.
 *   - Capacity: a trailer holds at most 30 t; the link is responsible for
 *     the extra (stated total − 30, else assumed 4 t). Both are placeholders
 *     Claire will refine during cleanup.
 *   - Drivers are keyed by accent-folded name; drivers sharing a phone or
 *     passport under different names are cross-flagged as likely duplicates.
 *
 * A tab that already has content is skipped, not overwritten: the cleanup
 * happens in these tabs, so a re-run only fills tabs that are still empty.
 * Use --force to clear every tab and regenerate from scratch.
 *
 * Usage:
 *   node packages/db/scripts/fill-logbook-fleet-drivers.mjs [--dry] [--yes] [--force] [--book <id>]
 */

import { loadEnv, googleAccessToken, sheetsGet, getValues, setValues, batchUpdate } from "./google-sheets.mjs";
import * as map from "./logbook-mapping.mjs";

const DRY = process.argv.includes("--dry");
const ASSUME_YES = process.argv.includes("--yes");
const FORCE = process.argv.includes("--force");

// The production DATABASE LOGBOOK. The env spreadsheet is the DEV copy, and
// this fill is for the book Claire actually cleans — so the id is explicit,
// with --book to point elsewhere (e.g. a trial run against the dev copy).
const bookArg = process.argv.indexOf("--book");
const spreadsheetId =
    bookArg > -1 ? process.argv[bookArg + 1] : "1SwdgB7JUIVCeIW7AIMRMRYhLSVtB7rrhKV8sSfcBccc";

const env = loadEnv();
const token = await googleAccessToken(env);

const meta = await sheetsGet(
    token,
    spreadsheetId,
    "?fields=properties.title,sheets(properties(title,sheetId,gridProperties(rowCount)))",
);
console.log(`spreadsheet: ${meta.properties.title} (${spreadsheetId})`);
console.log(DRY ? "mode:        DRY RUN — nothing is written\n" : "mode:        WRITE\n");

const sheetIdByTitle = new Map(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
const rowCountByTitle = new Map(meta.sheets.map((s) => [s.properties.title, s.properties.gridProperties.rowCount]));
if (!sheetIdByTitle.has("ORDERS")) throw new Error(`spreadsheet has no "ORDERS" tab`);

/**
 * ORDERS
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

const NEEDED = [
    "Order Id", "Carrier", "Deal Date", "Expected Loading Date", "Actual Loading Date",
    "Truck Plate", "Trailer Plate", "Link Plate", "Truck Age", "Loading Capacity",
    "Weight", "Weight Uint", "Loaded Weight", "Offloaded Weight",
    "Driver Name", "Contact", "Passport",
];
const missing = NEEDED.filter((header) => !map.hasColumn(columns, header));
if (missing.length) console.log(`headers not found (their data is skipped): ${missing.join(", ")}\n`);

const rows = values.slice(map.HEADER_ROW).filter((row) => String(row.slice(0, 60).join("")).trim() !== "");
console.log(`${rows.length} order rows read from ORDERS`);

const norm = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const fold = (value) => norm(value).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const plate = (value) => norm(value).toUpperCase();
const plateIdentity = (registration) => registration.replace(/[^A-Z0-9]/g, "");

// Plate cells that are really "no data": blank markers, or too short to be a
// registration anywhere the logbook's trucks come from
const JUNK = /^(NDA|N\/?A|TBC|TBA|NONE|NIL|X+|-+)$/i;
const isRealPlate = (registration) => {
    const identity = plateIdentity(registration);
    return identity.length >= 4 && !JUNK.test(norm(registration));
};

const isRealName = (name) => {
    if (!name || name.length < 3 || JUNK.test(name)) return false;
    return /[a-z]{2}/i.test(fold(name));
};

/** Tonnes. The unit column when stated; otherwise anything over 200 is kg. */
const tons = (value, unit) => {
    // "30 Tons" and friends: fall back to the first number in the cell
    const parsed = map.number(value) ?? map.number(String(value ?? "").match(/\d+(?:[.,]\d+)?/)?.[0]);
    if (parsed === null || parsed <= 0) return null;
    if (unit === "kg") return parsed / 1000;
    if (unit === "liter") return null;
    return parsed > 200 ? parsed / 1000 : parsed;
};

const bump = (counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1);
const mostCommon = (counts) => [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
const alternates = (counts) => {
    const winner = mostCommon(counts);
    return [...counts.keys()].filter((value) => value !== winner);
};
const round1 = (value) => Math.round(value * 10) / 10;

/**
 * Pass over ORDERS: one normalized record per row.
 */
const records = rows.map((row) => {
    const read = (header) => cell(row, header);
    const weightUnit = map.weightUnit(read("Weight Uint"));
    const truckRaw = plate(read("Truck Plate"));
    const trailerRaw = plate(read("Trailer Plate"));
    const linkRaw = plate(read("Link Plate"));
    return {
        carrier: norm(read("Carrier")),
        date:
            map.date(read("Deal Date")) ??
            map.date(read("Expected Loading Date")) ??
            map.date(read("Actual Loading Date")),
        truck: isRealPlate(truckRaw) ? truckRaw : "",
        trailer: isRealPlate(trailerRaw) ? trailerRaw : "",
        link: isRealPlate(linkRaw) ? linkRaw : "",
        truckAge: norm(read("Truck Age")),
        capacity: tons(read("Loading Capacity")),
        carried:
            tons(read("Weight"), weightUnit) ??
            tons(read("Loaded Weight"), weightUnit) ??
            tons(read("Offloaded Weight"), weightUnit),
        driver: isRealName(norm(read("Driver Name"))) ? norm(read("Driver Name")) : "",
        contact: norm(read("Contact")),
        passport: norm(read("Passport")),
    };
});

/**
 * Vehicles, one entry per plate identity.
 */
const makeUnit = () => ({
    spellings: new Map(),
    carriers: new Map(),
    ages: new Map(),
    capacities: new Map(),
    maxCarried: null,
    partners: new Map(), // trucks: trailers+links seen; trailers: trucks; links: trailers
    drivers: new Map(),
    orders: 0,
    first: null,
    last: null,
    articulated: false,
    sawLink: false,
    linklessOrders: 0, // links only: orders naming the link but no trailer
});

const trucks = new Map();
const trailers = new Map();
const links = new Map();

const touch = (index, registration) => {
    const identity = plateIdentity(registration);
    const entry = index.get(identity) ?? makeUnit();
    index.set(identity, entry);
    bump(entry.spellings, registration);
    return entry;
};

for (const record of records) {
    const units = [];
    if (record.truck) units.push(touch(trucks, record.truck));
    if (record.trailer) units.push(touch(trailers, record.trailer));
    if (record.link) units.push(touch(links, record.link));

    for (const unit of units) {
        unit.orders++;
        if (record.carrier) bump(unit.carriers, record.carrier);
        if (record.capacity !== null) bump(unit.capacities, record.capacity);
        if (record.carried !== null) unit.maxCarried = Math.max(unit.maxCarried ?? 0, record.carried);
        if (record.date) {
            const day = record.date.slice(0, 10);
            unit.first = unit.first === null || day < unit.first ? day : unit.first;
            unit.last = unit.last === null || day > unit.last ? day : unit.last;
        }
    }

    if (record.truck) {
        const entry = trucks.get(plateIdentity(record.truck));
        if (record.truckAge) bump(entry.ages, record.truckAge);
        if (record.driver) bump(entry.drivers, record.driver);
        if (record.trailer || record.link) entry.articulated = true;
        if (record.link) entry.sawLink = true;
        if (record.trailer) bump(entry.partners, record.trailer);
        if (record.link) bump(entry.partners, record.link);
    }
    if (record.trailer) {
        const entry = trailers.get(plateIdentity(record.trailer));
        if (record.link) entry.sawLink = true;
        if (record.truck) bump(entry.partners, record.truck);
    }
    if (record.link) {
        const entry = links.get(plateIdentity(record.link));
        if (record.trailer) bump(entry.partners, record.trailer);
        else entry.linklessOrders++;
    }
}

// A plate that appears under more than one unit column is a column mix-up on
// some order row — worth a flag on every row it produced.
const unitsOf = new Map();
for (const [kind, index] of [["truck", trucks], ["trailer", trailers], ["link", links]]) {
    for (const identity of index.keys()) {
        const list = unitsOf.get(identity) ?? [];
        list.push(kind);
        unitsOf.set(identity, list);
    }
}
const crossNote = (identity, self) => {
    const others = (unitsOf.get(identity) ?? []).filter((kind) => kind !== self);
    return others.length ? `also appears as a ${others.join(" and a ")} plate` : null;
};

/**
 * Rows, one tab per unit type so each tab reads clean.
 */
const canonicalIn = (indexes) => (registration) => {
    if (!registration) return "";
    for (const index of indexes) {
        const entry = index.get(plateIdentity(registration));
        if (entry) return mostCommon(entry.spellings);
    }
    return registration;
};

const partnersList = (entry, resolve) =>
    [...entry.partners.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([registration]) => resolve(registration))
        .filter((value, position, list) => list.indexOf(value) === position)
        .join(", ");

const anomalies = [];

const byCarrierThenPlate = (index) =>
    [...index.entries()].sort((a, b) => {
        const carrierA = mostCommon(a[1].carriers) ?? "￿"; // carrierless last
        const carrierB = mostCommon(b[1].carriers) ?? "￿";
        return carrierA.localeCompare(carrierB) || a[0].localeCompare(b[0]);
    });

const TRUCK_HEADERS = [
    "Reg Plate", "Carrier", "Classification", "Capacity (Ton)", "Max Carried (Ton)",
    "Truck Age", "Trailers / Links", "Drivers", "Orders", "First Order", "Last Order",
    "Other Spellings", "Other Carriers", "Brand", "Model", "Year", "VIN", "Notes",
];

const truckRows = byCarrierThenPlate(trucks).map(([identity, entry]) => {
    const statedCapacity = mostCommon(entry.capacities);
    const notes = [];
    const cross = crossNote(identity, "truck");
    if (cross) notes.push(cross);
    if (!entry.articulated && entry.maxCarried !== null && entry.maxCarried > 20) {
        notes.push(`carried ${round1(entry.maxCarried)} t but no trailer recorded — articulated?`);
    }
    if (entry.articulated && !entry.sawLink && entry.maxCarried !== null && entry.maxCarried > 31) {
        notes.push(`carried ${round1(entry.maxCarried)} t with no link recorded`);
    }
    if (entry.carriers.size === 0) notes.push("no carrier on any of its orders");
    if (notes.length) anomalies.push(`truck ${mostCommon(entry.spellings)}: ${notes.join("; ")}`);

    return [
        mostCommon(entry.spellings),
        mostCommon(entry.carriers) ?? "",
        entry.articulated ? "Articulated" : "Non-articulated",
        // The horse itself carries nothing when articulated — capacity then
        // lives on the trailer and link rows
        entry.articulated ? "" : statedCapacity !== null ? round1(Math.min(statedCapacity, 30)) : entry.maxCarried !== null ? round1(entry.maxCarried) : "",
        entry.maxCarried !== null ? round1(entry.maxCarried) : "",
        mostCommon(entry.ages) ?? "",
        partnersList(entry, canonicalIn([trailers, links])),
        [...entry.drivers.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 5).join(", "),
        entry.orders,
        entry.first ?? "",
        entry.last ?? "",
        alternates(entry.spellings).join(", "),
        alternates(entry.carriers).join(", "),
        "", "", "", "", // Brand / Model / Year / VIN — for the cleanup pass
        notes.join("; "),
    ];
});

const TRAILER_HEADERS = [
    "Reg Plate", "Carrier", "Capacity (Ton)", "Max Carried (Ton)", "Trucks", "Orders",
    "First Order", "Last Order", "Other Spellings", "Other Carriers",
    "Brand", "Model", "Year", "VIN", "Notes",
];

const trailerRows = byCarrierThenPlate(trailers).map(([identity, entry]) => {
    const statedCapacity = mostCommon(entry.capacities);
    const notes = [];
    const cross = crossNote(identity, "trailer");
    if (cross) notes.push(cross);
    if (statedCapacity !== null && statedCapacity > 30) {
        notes.push(`orders state ${round1(statedCapacity)} t — 30 kept here, the rest on the link`);
    }
    if (notes.length) anomalies.push(`trailer ${mostCommon(entry.spellings)}: ${notes.join("; ")}`);

    return [
        mostCommon(entry.spellings),
        mostCommon(entry.carriers) ?? "",
        // Claire's rule: a trailer holds at most 30 t; 30 stands in when the
        // logbook never stated a capacity
        statedCapacity !== null ? round1(Math.min(statedCapacity, 30)) : 30,
        entry.maxCarried !== null ? round1(entry.maxCarried) : "",
        partnersList(entry, canonicalIn([trucks])),
        entry.orders,
        entry.first ?? "",
        entry.last ?? "",
        alternates(entry.spellings).join(", "),
        alternates(entry.carriers).join(", "),
        "", "", "", "",
        notes.join("; "),
    ];
});

const LINK_HEADERS = [
    "Reg Plate", "Carrier", "Capacity (Ton)", "Max Carried (Ton)", "Trailers", "Orders",
    "First Order", "Last Order", "Other Spellings", "Other Carriers",
    "Brand", "Model", "Year", "VIN", "Notes",
];

const linkRows = byCarrierThenPlate(links).map(([identity, entry]) => {
    const statedTotal = mostCommon(entry.capacities);
    const extra = statedTotal !== null && statedTotal > 30 ? round1(statedTotal - 30) : null;
    const notes = [];
    const cross = crossNote(identity, "link");
    if (cross) notes.push(cross);
    if (extra !== null && (extra < 1 || extra > 10)) {
        notes.push(`stated total ${round1(statedTotal)} t gives an odd link share — assumed 4 t`);
    }
    if (entry.linklessOrders) notes.push(`named without a trailer on ${entry.linklessOrders} order(s)`);
    if (notes.length) anomalies.push(`link ${mostCommon(entry.spellings)}: ${notes.join("; ")}`);

    return [
        mostCommon(entry.spellings),
        mostCommon(entry.carriers) ?? "",
        // The link takes what the stated combo total says is beyond the
        // trailer's 30 t, else the assumed 4 t Claire gave as the placeholder
        extra !== null && extra >= 1 && extra <= 10 ? extra : 4,
        entry.maxCarried !== null ? round1(entry.maxCarried) : "",
        partnersList(entry, canonicalIn([trailers])),
        entry.orders,
        entry.first ?? "",
        entry.last ?? "",
        alternates(entry.spellings).join(", "),
        alternates(entry.carriers).join(", "),
        "", "", "", "",
        notes.join("; "),
    ];
});

/**
 * Drivers, keyed by accent-folded name.
 */
const driverEntries = new Map();
for (const record of records) {
    if (!record.driver) continue;
    const k = fold(record.driver);
    const entry = driverEntries.get(k) ?? {
        spellings: new Map(), contacts: new Map(), passports: new Map(),
        carriers: new Map(), trucks: new Map(), orders: 0, first: null, last: null,
    };
    driverEntries.set(k, entry);
    entry.orders++;
    bump(entry.spellings, record.driver);
    if (record.contact) bump(entry.contacts, record.contact);
    if (record.passport) bump(entry.passports, record.passport);
    if (record.carrier) bump(entry.carriers, record.carrier);
    if (record.truck) bump(entry.trucks, canonicalIn([trucks])(record.truck));
    if (record.date) {
        const day = record.date.slice(0, 10);
        entry.first = entry.first === null || day < entry.first ? day : entry.first;
        entry.last = entry.last === null || day > entry.last ? day : entry.last;
    }
}

// Likely duplicates: two names sharing a phone (compared on the last 9
// digits, Mozambican numbers) or sharing a passport.
const digitsOf = (contact) =>
    [...String(contact).matchAll(/\d[\d\s-]{6,}\d/g)].map((match) => {
        const digits = match[0].replace(/\D/g, "");
        return digits.slice(-9);
    });

const byPhone = new Map();
const byPassport = new Map();
for (const [k, entry] of driverEntries) {
    for (const contact of entry.contacts.keys()) {
        for (const digits of digitsOf(contact)) {
            const list = byPhone.get(digits) ?? [];
            if (!list.includes(k)) list.push(k);
            byPhone.set(digits, list);
        }
    }
    for (const passport of entry.passports.keys()) {
        const foldedPassport = fold(passport).replace(/[^a-z0-9]/g, "");
        if (foldedPassport.length < 5) continue;
        const list = byPassport.get(foldedPassport) ?? [];
        if (!list.includes(k)) list.push(k);
        byPassport.set(foldedPassport, list);
    }
}

const duplicateOf = new Map(); // folded name -> Set of other display names
const markDuplicates = (groups, via) => {
    for (const group of groups.values()) {
        if (group.length < 2) continue;
        for (const k of group) {
            const others = duplicateOf.get(k) ?? new Set();
            for (const other of group) {
                if (other !== k) others.add(`${mostCommon(driverEntries.get(other).spellings)} (same ${via})`);
            }
            duplicateOf.set(k, others);
        }
    }
};
markDuplicates(byPhone, "phone");
markDuplicates(byPassport, "passport");

const DRIVER_HEADERS = [
    "Driver Name", "Contact", "Passport", "Carrier", "Trucks Driven", "Orders",
    "First Order", "Last Order", "Other Contacts", "Other Carriers",
    "Possible Duplicate Of", "Notes",
];

const driverRows = [...driverEntries.entries()]
    .sort((a, b) => {
        const carrierA = mostCommon(a[1].carriers) ?? "￿";
        const carrierB = mostCommon(b[1].carriers) ?? "￿";
        return carrierA.localeCompare(carrierB) || a[0].localeCompare(b[0]);
    })
    .map(([k, entry]) => {
        const notes = [];
        if (entry.passports.size > 1) notes.push(`passports differ: ${[...entry.passports.keys()].join(" / ")}`);
        if (entry.carriers.size === 0) notes.push("no carrier on any of their orders");
        if (notes.length) anomalies.push(`driver ${mostCommon(entry.spellings)}: ${notes.join("; ")}`);
        return [
            mostCommon(entry.spellings),
            mostCommon(entry.contacts) ?? "",
            mostCommon(entry.passports) ?? "",
            mostCommon(entry.carriers) ?? "",
            [...entry.trucks.entries()].sort((a, b) => b[1] - a[1]).map(([registration]) => registration).join(", "),
            entry.orders,
            entry.first ?? "",
            entry.last ?? "",
            alternates(entry.contacts).join(", "),
            alternates(entry.carriers).join(", "),
            [...(duplicateOf.get(k) ?? [])].join(", "),
            notes.join("; "),
        ];
    });

/**
 * Report
 */
const articulatedCount = [...trucks.values()].filter((entry) => entry.articulated).length;
console.log(`\ntrucks: ${truckRows.length} (${articulatedCount} articulated, ${trucks.size - articulatedCount} non-articulated)`);
console.log(`trailers: ${trailerRows.length}   links: ${linkRows.length}`);
console.log(`drivers: ${driverRows.length} (${[...duplicateOf.keys()].length} flagged as possible duplicates)`);

const spellingFixes = [...trucks.values(), ...trailers.values(), ...links.values()]
    .reduce((total, entry) => total + entry.spellings.size - 1, 0);
console.log(`plate spellings folded: ${spellingFixes}`);

if (anomalies.length) {
    console.log(`\n--- flagged for the cleanup (${anomalies.length}) ---`);
    for (const line of anomalies) console.log(`  ${line}`);
}

const TABS = [
    ["TRUCKS", TRUCK_HEADERS, truckRows],
    ["TRAILERS", TRAILER_HEADERS, trailerRows],
    ["LINKS", LINK_HEADERS, linkRows],
    ["DRIVERS", DRIVER_HEADERS, driverRows],
];

if (DRY) {
    for (const [tab, , tabRows] of TABS) {
        console.log(`\n--- sample ${tab} rows ---`);
        for (const row of tabRows.slice(0, 4)) console.log(`  ${JSON.stringify(row)}`);
    }
    process.exit(0);
}

if (!ASSUME_YES) {
    console.log(`\nAbout to write ${TABS.map(([tab, , tabRows]) => `${tabRows.length} ${tab}`).join(", ")} rows to "${meta.properties.title}".`);
    console.log("Re-run with --yes to proceed (add --force to clear and regenerate non-empty tabs).");
    process.exit(1);
}

/**
 * Write. A non-empty tab means the cleanup has started — leave it alone
 * unless --force says to regenerate it.
 */
for (const [tab, headers, tabRows] of TABS) {
    const needed = tabRows.length + 1;

    if (!sheetIdByTitle.has(tab)) {
        console.log(`creating ${tab}...`);
        const created = await batchUpdate(token, spreadsheetId, [
            {
                addSheet: {
                    properties: {
                        title: tab,
                        gridProperties: { rowCount: needed + 50, columnCount: 26 },
                    },
                },
            },
        ]);
        sheetIdByTitle.set(tab, created.replies[0].addSheet.properties.sheetId);
        rowCountByTitle.set(tab, needed + 50);
    } else {
        const existing = await getValues(token, spreadsheetId, tab, "A1:Z5000");
        const hasContent = existing.some((row) => row.some((value) => String(value ?? "").trim() !== ""));
        if (hasContent && !FORCE) {
            console.log(`${tab}: not empty — skipped (it may hold cleanup work; --force regenerates it)`);
            continue;
        }
        if (hasContent && FORCE) {
            console.log(`clearing ${tab}...`);
            await batchUpdate(token, spreadsheetId, [
                {
                    updateCells: {
                        range: { sheetId: sheetIdByTitle.get(tab) },
                        fields: "userEnteredValue,userEnteredFormat",
                    },
                },
            ]);
        }
        // values.update refuses to write past the grid, so grow a short tab
        if ((rowCountByTitle.get(tab) ?? 1000) < needed) {
            await batchUpdate(token, spreadsheetId, [
                {
                    appendDimension: {
                        sheetId: sheetIdByTitle.get(tab),
                        dimension: "ROWS",
                        length: needed + 50 - rowCountByTitle.get(tab),
                    },
                },
            ]);
        }
    }

    console.log(`writing ${tab} (${tabRows.length} rows)...`);
    await setValues(token, spreadsheetId, tab, "A1", [headers, ...tabRows]);

    // Bold + frozen header and a filter across the data: the tabs exist to
    // be sorted and combed through by hand.
    await batchUpdate(token, spreadsheetId, [
        {
            repeatCell: {
                range: { sheetId: sheetIdByTitle.get(tab), startRowIndex: 0, endRowIndex: 1 },
                cell: { userEnteredFormat: { textFormat: { bold: true } } },
                fields: "userEnteredFormat.textFormat.bold",
            },
        },
        {
            updateSheetProperties: {
                properties: { sheetId: sheetIdByTitle.get(tab), gridProperties: { frozenRowCount: 1 } },
                fields: "gridProperties.frozenRowCount",
            },
        },
        {
            setBasicFilter: {
                filter: {
                    range: {
                        sheetId: sheetIdByTitle.get(tab),
                        startRowIndex: 0,
                        endRowIndex: tabRows.length + 1,
                        startColumnIndex: 0,
                        endColumnIndex: headers.length,
                    },
                },
            },
        },
    ]);
}

console.log("\ndone");
