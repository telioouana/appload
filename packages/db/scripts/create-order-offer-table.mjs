/**
 * Creates the "order_offer" table (carrier quotes on an order: a prospect
 * becomes booked by accepting one).
 * Idempotent: `create … if not exists` / `create index if not exists`.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * SHARED DEV DATABASE ONLY — production applies the generated drizzle
 * migration (packages/db/drizzle/0011_*) with `pnpm --filter @workspace/db
 * db:migrate` (see RELEASE.md); never run both against the same database.
 *
 * Must stay in sync with packages/db/src/schemas/orders.ts (orderOffer).
 *
 * Usage:
 *   node packages/db/scripts/create-order-offer-table.mjs
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

await sql`
    create table if not exists "order_offer" (
        "id" text primary key,
        "order_id" text not null references "order"("id") on delete cascade,
        "carrier_id" text not null references "organization"("id"),
        "carrier_name" text not null,
        "fiscal_regime" "fiscal_regime_enum" not null,
        "subtotal" numeric(14, 2),
        "vat" numeric(14, 2),
        "total" numeric(14, 2) not null,
        "currency" "currency_enum" not null,
        "commission_subtotal" numeric(14, 2),
        "commission_vat" numeric(14, 2),
        "commission_total" numeric(14, 2),
        "client_subtotal" numeric(14, 2),
        "client_vat" numeric(14, 2),
        "client_total" numeric(14, 2),
        "includes_git" boolean not null default false,
        "includes_gps" boolean not null default false,
        "notes" text,
        "status" text not null default 'pending',
        "carrier_since" timestamp,
        "carrier_trips" integer,
        "decided_at" timestamp,
        "decided_by" text references "user"("id") on delete set null,
        "decision_note" text,
        "created_by" text references "user"("id") on delete set null,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
    )`;

await sql`create index if not exists "order_offer_order_idx" on "order_offer" ("order_id")`;
// One accepted offer per order: the booking itself
await sql`create unique index if not exists "order_offer_accepted_uidx" on "order_offer" ("order_id") where "status" = 'accepted'`;
console.log("order_offer ensured");

const columns = await sql`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_name = 'order_offer'
    order by ordinal_position`;

console.table(columns);
