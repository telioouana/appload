/**
 * Renames the shipper leg's paid columns on "order" to say what they are
 * from Appload's side — money RECEIVED (the carrier leg stays "paid"):
 *   shipper_paid_amount      -> shipper_received_amount
 *   shipper_paid_percentage  -> shipper_received_percentage
 * Data-preserving RENAME COLUMN, idempotent: each rename runs only while the
 * old column still exists (Postgres has no RENAME COLUMN IF EXISTS).
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * SHARED DEV DATABASE ONLY — production applies the generated drizzle
 * migration with `pnpm --filter @workspace/db db:migrate` (see RELEASE.md);
 * never run both against the same database.
 *
 * Must stay in sync with packages/db/src/schemas/orders.ts.
 *
 * Usage:
 *   node packages/db/scripts/rename-shipper-paid-to-received.mjs
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

const [{ exists }] = await sql`select to_regclass('"order"') is not null as exists`;

if (!exists) {
    throw new Error('"order" table not found — nothing to alter');
}

const RENAMES = [
    ["shipper_paid_amount", "shipper_received_amount"],
    ["shipper_paid_percentage", "shipper_received_percentage"],
];

for (const [from, to] of RENAMES) {
    const [{ present }] = await sql`
        select count(*)::int as present
        from information_schema.columns
        where table_name = 'order' and column_name = ${from}`;

    if (present === 0) {
        console.log(`${from} already renamed — skipping`);
        continue;
    }

    // Identifiers cannot be parameterised; the names come from the list above
    await sql.query(`alter table "order" rename column "${from}" to "${to}"`);
    console.log(`${from} -> ${to}`);
}

const columns = await sql`
    select column_name, data_type
    from information_schema.columns
    where table_name = 'order'
      and column_name in ('shipper_paid_amount', 'shipper_paid_percentage', 'shipper_received_amount', 'shipper_received_percentage', 'carrier_paid_amount', 'carrier_paid_percentage')
    order by column_name`;

console.log("order paid/received columns:");
console.table(columns);
