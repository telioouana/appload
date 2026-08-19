/**
 * Drops the redundant "paid partially" flags from "order":
 *   shipper_paid_partially, carrier_paid_partially
 * and the "confirmation_enum" type they were the only users of. The
 * per-party payment status already says whether a payment is partial
 * (pending / partially / completed / not-applicable), so the flag carried no
 * information of its own. Idempotent: `drop column if exists`,
 * `drop type if exists`.
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
 *   node packages/db/scripts/drop-paid-partially-columns.mjs
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

await sql`alter table "order" drop column if exists "shipper_paid_partially"`;
await sql`alter table "order" drop column if exists "carrier_paid_partially"`;
console.log("order paid-partially columns dropped");

// The enum type is unused once both columns are gone; a legacy table still
// referencing it would make this fail, so surface that instead of hiding it
await sql`drop type if exists "confirmation_enum"`;
console.log("confirmation_enum type dropped");

const columns = await sql`
    select column_name
    from information_schema.columns
    where table_name = 'order'
      and column_name in ('shipper_paid_partially', 'carrier_paid_partially')`;

const types = await sql`select typname from pg_type where typname = 'confirmation_enum'`;

console.log("remaining paid-partially columns:", columns.length, "| confirmation_enum types:", types.length);
