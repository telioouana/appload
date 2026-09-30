/**
 * One-off: rewrites every registered plate to the one spelling the apps now
 * store — uppercase, hyphens and runs of spaces as a single space
 * ("abc-123-mc" → "ABC 123 MC").
 *
 * Orders reference a vehicle by its plate, so the three order → fleet FKs are
 * first made ON UPDATE CASCADE (what the schema now declares); the orders
 * then follow their vehicle. order_dispatch and the portal's movement rows
 * keep plain copies, rewritten with the same rule.
 *
 * A plate whose new spelling is already held by another vehicle of its kind
 * is listed and left alone: two rows for one vehicle is a merge for a person
 * to decide, not this script.
 *
 * Usage:
 *   node packages/db/scripts/normalize-plates.mjs            (dry run)
 *   node packages/db/scripts/normalize-plates.mjs --apply
 * (reads DATABASE_URL from apps/admin/.env or the environment)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connect } from "./sql.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function databaseUrl() {
    if (process.env.DATABASE_URL) {
        return process.env.DATABASE_URL;
    }

    const env = fs.readFileSync(path.join(root, "apps/admin/.env"), "utf8");
    const match = env.match(/^DATABASE_URL=(.+)$/m);

    if (!match) {
        throw new Error("DATABASE_URL not found in apps/admin/.env or the environment");
    }

    return match[1].trim();
}

// Same rule as normalizePlate in the two fleet routers
const normalizePlate = (value) => value.toUpperCase().replace(/[\s-]+/g, " ").trim();

const apply = process.argv.includes("--apply");
const sql = connect(databaseUrl());

const KINDS = ["truck", "trailer", "link"];

if (apply) {
    for (const kind of KINDS) {
        const name = `order_${kind}_plate_${kind}_reg_plate_fk`;

        await sql.query(`alter table "order" drop constraint if exists ${name}`);
        await sql.query(
            `alter table "order" add constraint ${name} foreign key (${kind}_plate) references ${kind}(reg_plate) on update cascade`,
        );
    }
}

let changed = 0;
let skipped = 0;

for (const kind of KINDS) {
    const rows = await sql.query(`select id, reg_plate from ${kind}`);
    const held = new Set(rows.map((row) => row.reg_plate));

    for (const row of rows) {
        const next = normalizePlate(row.reg_plate);

        if (next === row.reg_plate) continue;

        if (!next || held.has(next)) {
            skipped += 1;
            console.log(`SKIP ${kind} "${row.reg_plate}" → "${next}" (already held or empty)`);
            continue;
        }

        changed += 1;
        held.add(next);
        console.log(`${kind} "${row.reg_plate}" → "${next}"`);

        if (apply) {
            await sql.query(`update ${kind} set reg_plate = $1 where id = $2`, [next, row.id]);
        }
    }
}

// Same rule in SQL, for the copies no FK carries
const SQL_RULE = (column) => `trim(regexp_replace(upper(${column}), '[\\s-]+', ' ', 'g'))`;

const COPIES = [
    ...KINDS.map((kind) => ["order_dispatch", `${kind}_plate`]),
    // The portal's free-typed load plate
    ["movement", "truck_plate"],
];

for (const [table, column] of COPIES) {
    const where = `${column} is not null and ${column} <> ${SQL_RULE(column)}`;

    const [{ value }] = await sql.query(`select count(*)::int as value from ${table} where ${where}`);
    console.log(`${table}.${column}: ${value} to rewrite`);

    if (apply && value > 0) {
        await sql.query(`update ${table} set ${column} = ${SQL_RULE(column)} where ${where}`);
    }
}

console.log(`${apply ? "applied" : "dry run"}: ${changed} plates ${apply ? "rewritten" : "to rewrite"}, ${skipped} skipped`);
