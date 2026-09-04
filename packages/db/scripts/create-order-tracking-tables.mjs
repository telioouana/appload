/**
 * Creates the map tracking tables: "order_route" (cached Google Routes result
 * per order) and "order_location" (driver position pings, one per WhatsApp
 * chat message) plus their indexes.
 * Idempotent: `create table if not exists` / `create index if not exists`.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * SHARED DEV DATABASE ONLY — production applies the generated drizzle
 * migration (packages/db/drizzle/0010_*) with `pnpm --filter @workspace/db
 * db:migrate` (see RELEASE.md); never run both against the same database.
 *
 * One deliberate difference from the migration: the uniqueness of
 * order_location.chat_message_id is created here as the unique INDEX
 * "order_location_chat_message_uidx", where the migration creates the table
 * CONSTRAINT "order_location_chat_message_id_unique". Both are the same
 * unique index to Postgres and both satisfy `on conflict (chat_message_id)`;
 * only the name in pg_constraint differs.
 *
 * Must stay in sync with packages/db/src/schemas/tracking.ts (orderRoute,
 * orderLocation).
 *
 * Usage:
 *   node packages/db/scripts/create-order-tracking-tables.mjs
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

for (const table of ["order", "chat_conversation", "chat_message"]) {
    const [{ exists }] = await sql`select to_regclass(${`"${table}"`}) is not null as exists`;

    if (!exists) {
        throw new Error(`${table} table not found — this script expects the orders and chats schemas to exist`);
    }
}

await sql`
    create table if not exists "order_route" (
        "order_id" text primary key references "order"("id") on delete cascade,
        "origin_place_id" text not null,
        "destination_place_id" text not null,
        "origin_lat" double precision not null,
        "origin_lng" double precision not null,
        "destination_lat" double precision not null,
        "destination_lng" double precision not null,
        "encoded_polyline" text,
        "distance_meters" integer,
        "duration_seconds" integer,
        "source" text not null,
        "computed_at" timestamp not null default now()
    )`;
console.log("order_route ensured");

await sql`
    create table if not exists "order_location" (
        "id" text primary key,
        "order_id" text not null references "order"("id") on delete restrict,
        "conversation_id" text references "chat_conversation"("id") on delete set null,
        "chat_message_id" text references "chat_message"("id") on delete set null,
        "latitude" double precision not null,
        "longitude" double precision not null,
        "place_name" text,
        "source" text not null default 'whatsapp',
        "recorded_at" timestamp not null default now(),
        "created_at" timestamp not null default now()
    )`;

// A phone with no GPS fix reports 0,0 and a swapped pair reports nonsense; a
// ping is permanent, so junk coordinates are refused at the column. Added
// separately because the `create table if not exists` above is a no-op once
// the table exists.
await sql`
    do $$
    begin
        if not exists (select 1 from pg_constraint where conname = 'order_location_latlng_ck') then
            alter table "order_location"
                add constraint "order_location_latlng_ck"
                check (latitude between -90 and 90 and longitude between -180 and 180);
        end if;
    end
    $$`;

// One ping per chat message — what makes the webhook and the backfill idempotent
await sql`create unique index if not exists "order_location_chat_message_uidx" on "order_location" ("chat_message_id")`;
await sql`create index if not exists "order_location_order_recorded_idx" on "order_location" ("order_id", "recorded_at")`;
console.log("order_location ensured");

for (const table of ["order_route", "order_location"]) {
    const columns = await sql`
        select column_name, data_type, is_nullable, column_default
        from information_schema.columns
        where table_name = ${table}
        order by ordinal_position`;

    console.log(`${table}:`);
    console.table(columns);
}
