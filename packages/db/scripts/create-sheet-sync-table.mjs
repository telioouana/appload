/**
 * Creates the "sheet_sync" table (Google Sheets sync outbox). Idempotent:
 * exits early if the table already exists.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 *
 * Must stay in sync with packages/db/src/schemas/sheet-sync.ts.
 *
 * Usage:
 *   node packages/db/scripts/create-sheet-sync-table.mjs
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

const [{ exists }] = await sql`select to_regclass('sheet_sync') is not null as exists`;

if (exists) {
    console.log("sheet_sync already exists — nothing to do");
    process.exit(0);
}

await sql`
    create table "sheet_sync" (
        "order_id" text primary key references "order"("id") on delete restrict,
        "state" text not null default 'pending',
        "attempts" integer not null default 0,
        "last_error" text,
        "updated_at" timestamp not null default now()
    )`;

const columns = await sql`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_name = 'sheet_sync'
    order by ordinal_position`;

console.log("sheet_sync created:");
console.table(columns);
