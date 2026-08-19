/**
 * One-off migration: restore the order → fleet plate FK constraints that
 * were dropped on 2026-07-29 while the fleet registry was empty.
 *
 * Before adding the constraints it uppercases the plates on the existing
 * test orders so they match the registered fleet rows ("AAA 000 MC" /
 * "AA 000 MC" under Transportes FFS).
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 *
 * Usage:
 *   node packages/db/scripts/restore-plate-fks.mjs
 * (reads DATABASE_URL from apps/admin/.env or the environment)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";

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

const sql = neon(databaseUrl());

const existing = await sql`
    select conname from pg_constraint
    where conrelid = '"order"'::regclass and contype = 'f' and conname like '%plate%'`;

if (existing.length > 0) {
    console.log("plate FKs already present:", existing.map((row) => row.conname));
    process.exit(0);
}

const before = await sql`
    select order_id, truck_plate, trailer_plate, link_plate from "order"
    where truck_plate is not null or trailer_plate is not null or link_plate is not null`;
console.log("orders with plates (will be uppercased):", JSON.stringify(before));

await sql`
    update "order"
    set truck_plate = upper(truck_plate),
        trailer_plate = upper(trailer_plate),
        link_plate = upper(link_plate)
    where truck_plate is not null or trailer_plate is not null or link_plate is not null`;

await sql`alter table "order" add constraint order_truck_plate_truck_reg_plate_fk foreign key (truck_plate) references truck(reg_plate)`;
await sql`alter table "order" add constraint order_trailer_plate_trailer_reg_plate_fk foreign key (trailer_plate) references trailer(reg_plate)`;
await sql`alter table "order" add constraint order_link_plate_link_reg_plate_fk foreign key (link_plate) references link(reg_plate)`;

const fks = await sql`
    select conname from pg_constraint
    where conrelid = '"order"'::regclass and contype = 'f' order by conname`;
console.log("order FKs now:", fks.map((row) => row.conname));
