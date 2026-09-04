/**
 * Creates the "order_dispute" table and the "dispute_status" mirror column
 * on "order" (theft / loss / damage disputes with payment holds).
 * Idempotent: `create … if not exists` / `add column if not exists`.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * SHARED DEV DATABASE ONLY — production applies the generated drizzle
 * migration (packages/db/drizzle/0009_*) with `pnpm --filter @workspace/db
 * db:migrate` (see RELEASE.md); never run both against the same database.
 *
 * Must stay in sync with packages/db/src/schemas/orders.ts (orderDispute).
 *
 * Usage:
 *   node packages/db/scripts/create-order-dispute-table.mjs
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
    throw new Error("order table not found — this script expects the orders schema to exist");
}

await sql`alter table "order" add column if not exists "dispute_status" text`;
console.log("order.dispute_status ensured");

await sql`
    create table if not exists "order_dispute" (
        "id" text primary key,
        "order_id" text not null references "order"("id") on delete restrict,
        "reason" text not null,
        "status" text not null default 'open',
        "description" text not null,
        "claimed_amount" numeric(14, 2),
        "claimed_currency" "currency_enum",
        "liable_party" text,
        "hold_shipper_payments" boolean not null default true,
        "hold_carrier_payments" boolean not null default true,
        "carrier_debt_amount" numeric(14, 2),
        "carrier_debt_currency" "currency_enum",
        "deduction_terms" jsonb,
        "resolution" text,
        "opened_by" text references "user"("id") on delete set null,
        "opened_at" timestamp not null default now(),
        "resolved_by" text references "user"("id") on delete set null,
        "resolved_at" timestamp,
        "version" integer not null default 1,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
    )`;

await sql`create index if not exists "order_dispute_order_idx" on "order_dispute" ("order_id")`;
await sql`create index if not exists "order_dispute_status_idx" on "order_dispute" ("status")`;
// One active dispute per order
await sql`create unique index if not exists "order_dispute_active_uidx" on "order_dispute" ("order_id") where "status" in ('open', 'under-review')`;
console.log("order_dispute ensured");

const columns = await sql`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_name = 'order_dispute'
    order by ordinal_position`;

console.table(columns);

const [mirror] = await sql`
    select column_name, data_type
    from information_schema.columns
    where table_name = 'order' and column_name = 'dispute_status'`;

console.log("order.dispute_status:", mirror);
