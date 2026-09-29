/**
 * Creates `movement_request`: a load's quote round — one row per transporter
 * the owner asked, carrying that transporter's price. Nothing is backfilled:
 * no load has been out for quotes before this table existed. Idempotent:
 * `create table if not exists` / `create index if not exists`.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * SHARED DEV DATABASE ONLY — production applies the generated drizzle
 * migration (packages/db/drizzle/0024_movement_request.sql) with
 * `pnpm --filter @workspace/db db:migrate` (see RELEASE.md); never run both
 * against the same database.
 *
 * Must stay in sync with packages/db/src/schemas/movements.ts
 * (movementRequest).
 *
 * Usage:
 *   node packages/db/scripts/create-movement-request.mjs
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

const [{ exists }] = await sql`select to_regclass('"movement"') is not null as exists`;

if (!exists) {
    throw new Error("movement table not found — run create-movement-tables.mjs (or rename-trip-to-movement.mjs) first");
}

await sql`
    create table if not exists "movement_request" (
        "id" text primary key not null,
        "movement_id" text not null references "movement" ("id") on delete cascade,
        "carrier_org_id" text not null references "organization" ("id"),
        "status" text default 'requested' not null,
        "message" text,
        "quote_subtotal" numeric(14, 2),
        "quote_vat" numeric(14, 2),
        "quote_total" numeric(14, 2),
        "quote_currency" "currency_enum",
        "quote_fiscal_regime" "fiscal_regime_enum",
        "note" text,
        "created_by" text references "user" ("id") on delete set null,
        "responded_at" timestamp,
        "created_at" timestamp default now() not null,
        "updated_at" timestamp default now() not null,
        constraint "movement_request_quote_currency_ck" check ("quote_total" is null or "quote_currency" is not null)
    )`;
console.log("movement_request ensured");

// One row per (load, transporter): asking again reopens it rather than
// stacking a second request
await sql`create unique index if not exists "movement_request_movement_carrier_uidx" on "movement_request" ("movement_id", "carrier_org_id")`;
await sql`create index if not exists "movement_request_carrier_status_idx" on "movement_request" ("carrier_org_id", "status")`;
console.log("movement_request indexes ensured");

const columns = await sql`
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_name = 'movement_request'
    order by ordinal_position`;

console.table(columns);
