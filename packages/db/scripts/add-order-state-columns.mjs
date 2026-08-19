/**
 * Adds the optimistic-locking and review-flag columns to "order":
 *   version, flagged_for_review, flag_reason, flagged_at, flagged_by.
 * Idempotent: `add column if not exists` throughout.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 *
 * Must stay in sync with packages/db/src/schemas/orders.ts.
 *
 * Usage:
 *   node packages/db/scripts/add-order-state-columns.mjs
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

await sql`alter table "order" add column if not exists "version" integer not null default 1`;
await sql`alter table "order" add column if not exists "flagged_for_review" boolean not null default false`;
await sql`alter table "order" add column if not exists "flag_reason" text`;
await sql`alter table "order" add column if not exists "flagged_at" timestamp`;
await sql`alter table "order" add column if not exists "flagged_by" text references "user"("id") on delete set null`;

const columns = await sql`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_name = 'order'
      and column_name in ('version', 'flagged_for_review', 'flag_reason', 'flagged_at', 'flagged_by')
    order by ordinal_position`;

console.log("order state columns:");
console.table(columns);
