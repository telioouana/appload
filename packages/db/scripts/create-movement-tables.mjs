/**
 * Creates the portal's movement tables: "movement" (one load a tenant is
 * responsible for — its own truck when `execution` is "own-fleet", somebody
 * else's when it is "partner") plus "movement_route" / "movement_location" /
 * "movement_tracking_request" (the tracking machinery), "movement_cost" (what
 * the load cost to run), "movement_document" (its papers) and
 * "movement_event" (its append-only trail).
 * Idempotent: `create table if not exists` / `create index if not exists`.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * SHARED DEV DATABASE ONLY — production applies the generated drizzle
 * migration (packages/db/drizzle/0016_movements.sql) with `pnpm --filter
 * @workspace/db db:migrate` (see RELEASE.md); never run both against the same
 * database.
 *
 * A dev database that already carries the older "trip" tables is moved across
 * by rename-trip-to-movement.mjs instead, which keeps the rows. This script is
 * for a fresh one, where nothing has to be carried.
 *
 * Must stay in sync with packages/db/src/schemas/movements.ts.
 *
 * Usage:
 *   node packages/db/scripts/create-movement-tables.mjs
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

for (const table of ["organization", "user", "driver", "truck", "trailer", "link", "chat_conversation", "chat_message"]) {
    const [{ exists }] = await sql`select to_regclass(${`"${table}"`}) is not null as exists`;

    if (!exists) {
        throw new Error(`${table} table not found — this script expects the admin schema to exist`);
    }
}

// A database still on the old shape must be moved by the rename script, which
// carries its rows across; creating an empty "movement" beside a populated
// "trip" would leave two half-truths in one database.
const [{ legacy }] = await sql`select to_regclass('"trip"') is not null as legacy`;

if (legacy) {
    throw new Error('this database still has a "trip" table — run rename-trip-to-movement.mjs instead');
}

await sql`
    create table if not exists "movement" (
        "id" text primary key,
        "seq" serial not null,
        "organization_id" text not null references "organization"("id"),
        "execution" text not null default 'own-fleet',
        "status" text not null default 'procurement',
        "client_org_id" text references "organization"("id"),
        "client_name" text,
        "client_reference" text,
        "carrier_org_id" text references "organization"("id"),
        "carrier_name" text,
        "execution_movement_id" text references "movement"("id") on delete set null,
        "offered_at" timestamp,
        "responded_at" timestamp,
        "response_note" text,
        "driver_name" text,
        "driver_phone" text,
        "driver_id" text references "driver"("id") on delete set null,
        "truck_plate" text,
        "truck_id" text references "truck"("id") on delete set null,
        "trailer_id" text references "trailer"("id") on delete set null,
        "link_id" text references "link"("id") on delete set null,
        "conversation_id" text references "chat_conversation"("id") on delete set null,
        "origin" jsonb not null,
        "destination" jsonb not null,
        "route" "route_type_enum" not null default 'national',
        "cargo_description" text,
        "category" "categories_enum",
        "weight" numeric(10, 3),
        "weight_unit" "weight_unit_enum",
        "expected_loading_date" timestamp,
        "started_at" timestamp,
        "expected_delivery_at" timestamp,
        "delivered_at" timestamp,
        "closed_at" timestamp,
        "tracking_enabled" boolean not null default true,
        "sell_subtotal" numeric(14, 2),
        "sell_vat" numeric(14, 2),
        "sell_total" numeric(14, 2),
        "sell_currency" "currency_enum",
        "sell_fiscal_regime" "fiscal_regime_enum",
        "sell_invoice_number" text,
        "sell_invoice_date" timestamp,
        "sell_settlement" "payment_status_enum",
        "sell_received_amount" numeric(14, 2),
        "sell_settled_at" timestamp,
        "buy_subtotal" numeric(14, 2),
        "buy_vat" numeric(14, 2),
        "buy_total" numeric(14, 2),
        "buy_currency" "currency_enum",
        "buy_fiscal_regime" "fiscal_regime_enum",
        "buy_invoice_number" text,
        "buy_invoice_date" timestamp,
        "buy_settlement" "payment_status_enum",
        "buy_paid_amount" numeric(14, 2),
        "buy_settled_at" timestamp,
        "notes" text,
        "version" integer not null default 1,
        "created_by" text references "user"("id") on delete set null,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now(),
        constraint "movement_seq_unique" unique ("seq"),
        constraint "movement_execution_self_ck" check ("execution_movement_id" is distinct from "id"),
        constraint "movement_own_fleet_ck" check (
            "execution" = 'partner' or (
                "carrier_org_id" is null and "carrier_name" is null
                and "buy_total" is null and "execution_movement_id" is null
            )
        ),
        constraint "movement_sell_currency_ck" check ("sell_total" is null or "sell_currency" is not null),
        constraint "movement_buy_currency_ck" check ("buy_total" is null or "buy_currency" is not null)
    )`;

await sql`create index if not exists "movement_organization_status_idx" on "movement" ("organization_id", "status")`;
await sql`create index if not exists "movement_carrier_status_idx" on "movement" ("carrier_org_id", "status")`;
await sql`create index if not exists "movement_client_status_idx" on "movement" ("client_org_id", "status")`;
// The tracking cron's working set: on the road, with nobody downstream
// reporting for this driver
await sql`create index if not exists "movement_driver_phone_idx" on "movement" ("driver_phone") where "status" = 'in-transit' and "execution_movement_id" is null`;
// One executor movement answers at most one order
await sql`create unique index if not exists "movement_execution_uidx" on "movement" ("execution_movement_id") where "execution_movement_id" is not null`;
console.log("movement ensured");

await sql`
    create table if not exists "movement_route" (
        "movement_id" text primary key references "movement"("id") on delete cascade,
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
console.log("movement_route ensured");

await sql`
    create table if not exists "movement_location" (
        "id" text primary key,
        "movement_id" text not null references "movement"("id") on delete restrict,
        "conversation_id" text references "chat_conversation"("id") on delete set null,
        "chat_message_id" text references "chat_message"("id") on delete set null,
        "latitude" double precision not null,
        "longitude" double precision not null,
        "place_name" text,
        "source" text not null default 'whatsapp',
        "recorded_at" timestamp not null default now(),
        "created_at" timestamp not null default now(),
        constraint "movement_location_chat_message_id_unique" unique ("chat_message_id"),
        constraint "movement_location_latlng_ck" check (latitude between -90 and 90 and longitude between -180 and 180)
    )`;

await sql`create index if not exists "movement_location_movement_recorded_idx" on "movement_location" ("movement_id", "recorded_at")`;
console.log("movement_location ensured");

await sql`
    create table if not exists "movement_tracking_request" (
        "id" text primary key,
        "movement_id" text not null references "movement"("id") on delete restrict,
        "conversation_id" text references "chat_conversation"("id") on delete set null,
        "slot_date" text not null,
        "slot" text not null,
        "attempt" integer not null,
        "channel" text not null,
        "status" text not null default 'pending',
        "external_id" text,
        "error" text,
        "scheduled_for" timestamp not null,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
    )`;

await sql`create unique index if not exists "movement_tracking_request_slot_attempt_uidx" on "movement_tracking_request" ("movement_id", "slot_date", "slot", "attempt")`;
await sql`create index if not exists "movement_tracking_request_external_idx" on "movement_tracking_request" ("external_id")`;
console.log("movement_tracking_request ensured");

await sql`
    create table if not exists "movement_cost" (
        "id" text primary key,
        "movement_id" text not null references "movement"("id") on delete restrict,
        "kind" text not null,
        "description" text,
        "amount" numeric(14, 2) not null,
        "currency" "currency_enum" not null,
        "incurred_at" timestamp not null default now(),
        "rechargeable" boolean not null default false,
        "created_by" text references "user"("id") on delete set null,
        "deleted_at" timestamp,
        "deleted_by" text references "user"("id") on delete set null,
        "created_at" timestamp not null default now(),
        constraint "movement_cost_amount_ck" check ("amount" >= 0)
    )`;

await sql`create index if not exists "movement_cost_movement_idx" on "movement_cost" ("movement_id", "incurred_at")`;
console.log("movement_cost ensured");

await sql`
    create table if not exists "movement_document" (
        "id" text primary key,
        "movement_id" text not null references "movement"("id") on delete restrict,
        "type" text not null,
        "leg" text,
        "title" text,
        "url" text not null,
        "size" integer,
        "mime_type" text,
        "cost_id" text references "movement_cost"("id") on delete set null,
        "uploaded_by" text references "user"("id") on delete set null,
        "deleted_at" timestamp,
        "deleted_by" text references "user"("id") on delete set null,
        "created_at" timestamp not null default now()
    )`;

await sql`create index if not exists "movement_document_movement_idx" on "movement_document" ("movement_id", "created_at")`;
console.log("movement_document ensured");

await sql`
    create table if not exists "movement_event" (
        "id" text primary key,
        "movement_id" text not null references "movement"("id") on delete restrict,
        "actor_user_id" text references "user"("id") on delete set null,
        "actor_org_id" text references "organization"("id") on delete set null,
        "kind" text not null,
        "from_status" text,
        "to_status" text,
        "note" text,
        "metadata" jsonb,
        "created_at" timestamp not null default now()
    )`;

await sql`create index if not exists "movement_event_movement_idx" on "movement_event" ("movement_id", "created_at")`;
console.log("movement_event ensured");

const tables = [
    "movement",
    "movement_route",
    "movement_location",
    "movement_tracking_request",
    "movement_cost",
    "movement_document",
    "movement_event",
];

for (const table of tables) {
    const columns = await sql`
        select column_name, data_type, is_nullable, column_default
        from information_schema.columns
        where table_name = ${table}
        order by ordinal_position`;

    console.log(`${table}:`);
    console.table(columns);
}
