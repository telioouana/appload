/**
 * Moves a dev database that still carries the old "trip" tables onto the
 * "movement" shape, in place and with its rows: the four tables and their
 * "trip_id" columns are renamed, "counterparty_org_id" becomes
 * "client_org_id", the execution / money / link columns are added, and the
 * three new satellites are created. The allowance rows and the notification
 * kinds are remapped at the end.
 *
 * Idempotent throughout — every step is guarded by `to_regclass`, `if not
 * exists` or a catalogue lookup — so a half-finished run is picked up where
 * it stopped and a finished one is a no-op.
 *
 * SHARED DEV DATABASE ONLY. Production has never run 0014_portal, so it has
 * no "trip" table and nothing to rename: it applies
 * packages/db/drizzle/0016_movements.sql with `pnpm --filter @workspace/db
 * db:migrate` (see RELEASE.md), which creates the movement tables outright.
 * Never run both against the same database.
 *
 * A fresh dev database has no "trip" table either — use
 * create-movement-tables.mjs there; this script exits cleanly if it finds
 * nothing to move.
 *
 * Must stay in sync with packages/db/src/schemas/movements.ts.
 *
 * Usage:
 *   node packages/db/scripts/rename-trip-to-movement.mjs
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

const exists = async (table) => {
    const [row] = await sql`select to_regclass(${`"${table}"`}) is not null as present`;
    return row.present;
};

const hasColumn = async (table, column) => {
    const [row] = await sql`
        select exists (
            select 1 from information_schema.columns
            where table_name = ${table} and column_name = ${column}
        ) as present`;
    return row.present;
};

// ---------------------------------------------------------------------------
// 1. The four tables and the columns that point at them
// ---------------------------------------------------------------------------

const renames = [
    ["trip", "movement"],
    ["trip_route", "movement_route"],
    ["trip_location", "movement_location"],
    ["trip_tracking_request", "movement_tracking_request"],
];

for (const [from, to] of renames) {
    if (await exists(from)) {
        if (await exists(to)) {
            throw new Error(`both "${from}" and "${to}" exist — this database is half moved by hand, not by this script`);
        }

        await sql.query(`alter table "${from}" rename to "${to}"`);
        console.log(`${from} -> ${to}`);
    }
}

if (!(await exists("movement"))) {
    console.log('no "trip" and no "movement" table — this is a fresh database; run create-movement-tables.mjs');
    process.exit(0);
}

for (const table of ["movement_route", "movement_location", "movement_tracking_request"]) {
    if (await hasColumn(table, "trip_id")) {
        await sql.query(`alter table "${table}" rename column "trip_id" to "movement_id"`);
        console.log(`${table}.trip_id -> movement_id`);
    }
}

// The index and constraint names the schema snapshot records. Renaming them
// is cosmetic on dev, but a name that disagrees with the snapshot is exactly
// what makes the next `db:generate` produce a migration nobody asked for.
const objectRenames = [
    ["index", "trip_organization_status_idx", "movement_organization_status_idx"],
    ["index", "trip_location_trip_recorded_idx", "movement_location_movement_recorded_idx"],
    ["index", "trip_tracking_request_trip_slot_attempt_uidx", "movement_tracking_request_slot_attempt_uidx"],
    ["index", "trip_tracking_request_external_idx", "movement_tracking_request_external_idx"],
    ["index", "trip_driver_phone_idx", "movement_driver_phone_idx"],
];

for (const [, from, to] of objectRenames) {
    const [row] = await sql`select to_regclass(${`"${from}"`}) is not null as present`;

    if (row.present) {
        await sql.query(`alter index "${from}" rename to "${to}"`);
        console.log(`index ${from} -> ${to}`);
    }
}

// The counterparty index is dropped rather than renamed: the column it covers
// splits in two below, and the movement shape indexes both halves.
await sql`drop index if exists "trip_counterparty_status_idx"`;

// ---------------------------------------------------------------------------
// 2. The movement columns
// ---------------------------------------------------------------------------

// The single counterparty becomes the client: an own-fleet load's other side
// is who it is for. A partner-executed load names its executor in
// "carrier_org_id", which no trip ever had.
if (await hasColumn("movement", "counterparty_org_id")) {
    if (await hasColumn("movement", "client_org_id")) {
        throw new Error('"movement" has both counterparty_org_id and client_org_id — resolve by hand');
    }

    await sql`alter table "movement" rename column "counterparty_org_id" to "client_org_id"`;
    console.log("movement.counterparty_org_id -> client_org_id");
}

const columns = [
    `"execution" text not null default 'own-fleet'`,
    `"client_name" text`,
    `"client_reference" text`,
    `"carrier_org_id" text references "organization"("id")`,
    `"carrier_name" text`,
    `"execution_movement_id" text references "movement"("id") on delete set null`,
    `"offered_at" timestamp`,
    `"responded_at" timestamp`,
    `"response_note" text`,
    `"driver_id" text references "driver"("id") on delete set null`,
    `"truck_id" text references "truck"("id") on delete set null`,
    `"trailer_id" text references "trailer"("id") on delete set null`,
    `"link_id" text references "link"("id") on delete set null`,
    `"route" "route_type_enum" not null default 'national'`,
    `"category" "categories_enum"`,
    `"weight" numeric(10, 3)`,
    `"weight_unit" "weight_unit_enum"`,
    `"expected_loading_date" timestamp`,
    `"closed_at" timestamp`,
    `"sell_subtotal" numeric(14, 2)`,
    `"sell_vat" numeric(14, 2)`,
    `"sell_total" numeric(14, 2)`,
    `"sell_currency" "currency_enum"`,
    `"sell_fiscal_regime" "fiscal_regime_enum"`,
    `"sell_invoice_number" text`,
    `"sell_invoice_date" timestamp`,
    `"sell_settlement" "payment_status_enum"`,
    `"sell_received_amount" numeric(14, 2)`,
    `"sell_settled_at" timestamp`,
    `"buy_subtotal" numeric(14, 2)`,
    `"buy_vat" numeric(14, 2)`,
    `"buy_total" numeric(14, 2)`,
    `"buy_currency" "currency_enum"`,
    `"buy_fiscal_regime" "fiscal_regime_enum"`,
    `"buy_invoice_number" text`,
    `"buy_invoice_date" timestamp`,
    `"buy_settlement" "payment_status_enum"`,
    `"buy_paid_amount" numeric(14, 2)`,
    `"buy_settled_at" timestamp`,
    `"notes" text`,
    `"version" integer not null default 1`,
];

for (const column of columns) {
    await sql.query(`alter table "movement" add column if not exists ${column}`);
}

console.log(`movement: ${columns.length} columns ensured`);

// A movement can be filed before anyone is driving it; the trip form always
// named both, so nothing existing is affected.
await sql`alter table "movement" alter column "driver_name" drop not null`;
await sql`alter table "movement" alter column "driver_phone" drop not null`;
await sql`alter table "movement" alter column "status" set default 'procurement'`;

const checks = [
    [`movement_execution_self_ck`, `check ("execution_movement_id" is distinct from "id")`],
    [
        `movement_own_fleet_ck`,
        `check ("execution" = 'partner' or ("carrier_org_id" is null and "carrier_name" is null and "buy_total" is null and "execution_movement_id" is null))`,
    ],
    [`movement_sell_currency_ck`, `check ("sell_total" is null or "sell_currency" is not null)`],
    [`movement_buy_currency_ck`, `check ("buy_total" is null or "buy_currency" is not null)`],
];

for (const [name, body] of checks) {
    const [row] = await sql`select exists (select 1 from pg_constraint where conname = ${name}) as present`;

    if (!row.present) {
        await sql.query(`alter table "movement" add constraint "${name}" ${body}`);
        console.log(`constraint ${name} added`);
    }
}

await sql`create index if not exists "movement_client_status_idx" on "movement" ("client_org_id", "status")`;
await sql`create index if not exists "movement_carrier_status_idx" on "movement" ("carrier_org_id", "status")`;
await sql`create unique index if not exists "movement_execution_uidx" on "movement" ("execution_movement_id") where "execution_movement_id" is not null`;

// The cron's working set gained the "nobody downstream is reporting" clause,
// so the old partial index no longer describes it.
await sql`drop index if exists "movement_driver_phone_idx"`;
await sql`create index if not exists "movement_driver_phone_idx" on "movement" ("driver_phone") where "status" = 'in-transit' and "execution_movement_id" is null`;
console.log("movement indexes ensured");

// ---------------------------------------------------------------------------
// 3. The three new satellites
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 4. The rows that named the old shape
// ---------------------------------------------------------------------------

const billed = await sql`
    update "subscription_usage" set "entity_type" = 'movement'
    where "entity_type" = 'trip'
    returning "id"`;
console.log(`subscription_usage: ${billed.length} rows remapped`);

// Three notification kinds went with the trip tables. A row whose kind no
// longer exists renders as nothing, so it is dropped rather than left to be
// discovered by whoever opens the inbox.
const dropped = await sql`delete from "notification" where "kind" like 'trip.%' returning "id"`;
console.log(`notification: ${dropped.length} rows on a kind that no longer exists dropped`);

const [{ movements }] = await sql`select count(*)::int as movements from "movement"`;
console.log(`done — ${movements} movement rows`);
