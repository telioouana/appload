/**
 * Creates the partner portal tables: "partner_connection" and
 * "organization_claim" (who is connected to whom, and who owns a company that
 * was loaded from the logbook), "order_request" and "quote" (a client's RFQ to
 * its carriers, a carrier's standing quote to its clients) and
 * "notification" / "notification_cursor" (the portal's notification centre).
 * The loads a tenant runs itself are in create-movement-tables.mjs.
 * Idempotent: `create table if not exists` / `create index if not exists`.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * SHARED DEV DATABASE ONLY — production applies the generated drizzle
 * migration (packages/db/drizzle/0014_portal.sql, then 0016_movements.sql)
 * with `pnpm --filter @workspace/db db:migrate` (see RELEASE.md); never run
 * both against the same database.
 *
 * The columns the portal adds to tables that already exist ("order".source,
 * organization.subscription_expires_at / portal_activated_at,
 * activity_log.app) are in add-portal-columns.mjs; run that one too.
 *
 * Must stay in sync with packages/db/src/schemas/connections.ts,
 * quotes.ts and notifications.ts.
 *
 * Usage:
 *   node packages/db/scripts/create-portal-tables.mjs
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

for (const table of ["order", "organization", "user", "chat_conversation", "chat_message", "activity_log"]) {
    const [{ exists }] = await sql`select to_regclass(${`"${table}"`}) is not null as exists`;

    if (!exists) {
        throw new Error(`${table} table not found — this script expects the admin schema to exist`);
    }
}

// The quote table reuses the order enums rather than declaring its own
for (const type of ["route_type_enum", "loading_bay_enum", "weight_unit_enum", "fiscal_regime_enum", "currency_enum"]) {
    const [{ exists }] = await sql`select to_regtype(${type}) is not null as exists`;

    if (!exists) {
        throw new Error(`${type} not found — this script expects the orders schema to exist`);
    }
}

await sql`
    create table if not exists "partner_connection" (
        "id" text primary key,
        "requester_org_id" text not null references "organization"("id") on delete restrict,
        "target_org_id" text not null references "organization"("id") on delete restrict,
        "relation" text not null,
        "status" text not null default 'pending',
        "accepted_via" text,
        "message" text,
        "requested_by_user_id" text references "user"("id") on delete set null,
        "responded_by_user_id" text references "user"("id") on delete set null,
        "responded_at" timestamp,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now(),
        constraint "partner_connection_distinct_ck" check ("requester_org_id" <> "target_org_id")
    )`;

// Added separately because the `create table if not exists` above is a no-op
// once the table exists
await sql`
    do $$
    begin
        if not exists (select 1 from pg_constraint where conname = 'partner_connection_distinct_ck') then
            alter table "partner_connection"
                add constraint "partner_connection_distinct_ck"
                check ("requester_org_id" <> "target_org_id");
        end if;
    end
    $$`;

// One row per pair regardless of who asked: sorting the two ids makes (a, b)
// and (b, a) the same index key
await sql`create unique index if not exists "partner_connection_pair_uidx" on "partner_connection" (least("requester_org_id", "target_org_id"), greatest("requester_org_id", "target_org_id"))`;
await sql`create index if not exists "partner_connection_target_status_idx" on "partner_connection" ("target_org_id", "status")`;
await sql`create index if not exists "partner_connection_requester_status_idx" on "partner_connection" ("requester_org_id", "status")`;
console.log("partner_connection ensured");

await sql`
    create table if not exists "organization_claim" (
        "id" text primary key,
        "organization_id" text not null references "organization"("id") on delete cascade,
        "user_id" text not null references "user"("id") on delete cascade,
        "status" text not null default 'pending',
        "auto_approved" boolean not null default false,
        "decided_by" text references "user"("id") on delete set null,
        "decided_at" timestamp,
        "decision_note" text,
        "created_at" timestamp not null default now()
    )`;

// One open claim per organization: the queue never shows two
await sql`create unique index if not exists "organization_claim_pending_uidx" on "organization_claim" ("organization_id") where "status" = 'pending'`;
await sql`create index if not exists "organization_claim_user_idx" on "organization_claim" ("user_id")`;
console.log("organization_claim ensured");

await sql`
    create table if not exists "order_request" (
        "id" text primary key,
        "order_id" text not null references "order"("id") on delete cascade,
        "carrier_org_id" text not null references "organization"("id"),
        "status" text not null default 'requested',
        "message" text,
        "created_by" text references "user"("id") on delete set null,
        "responded_at" timestamp,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
    )`;

await sql`create unique index if not exists "order_request_order_carrier_uidx" on "order_request" ("order_id", "carrier_org_id")`;
await sql`create index if not exists "order_request_carrier_status_idx" on "order_request" ("carrier_org_id", "status")`;
console.log("order_request ensured");

await sql`
    create table if not exists "quote" (
        "id" text primary key,
        "carrier_org_id" text not null references "organization"("id"),
        "client_org_id" text not null references "organization"("id"),
        "origin" jsonb not null,
        "destination" jsonb not null,
        "loading_date" timestamp,
        "route" "route_type_enum" not null default 'national',
        "loading_bay" "loading_bay_enum",
        "capacity_weight" numeric(10, 3),
        "capacity_unit" "weight_unit_enum",
        "fiscal_regime" "fiscal_regime_enum" not null,
        "subtotal" numeric(14, 2),
        "vat" numeric(14, 2),
        "total" numeric(14, 2) not null,
        "currency" "currency_enum" not null,
        "includes_git" boolean not null default false,
        "includes_gps" boolean not null default false,
        "notes" text,
        "valid_until" timestamp,
        "status" text not null default 'sent',
        "order_id" text references "order"("id") on delete set null,
        "created_by" text references "user"("id") on delete set null,
        "decided_by" text references "user"("id") on delete set null,
        "decided_at" timestamp,
        "created_at" timestamp not null default now(),
        "updated_at" timestamp not null default now()
    )`;

await sql`create index if not exists "quote_client_status_idx" on "quote" ("client_org_id", "status")`;
await sql`create index if not exists "quote_carrier_status_idx" on "quote" ("carrier_org_id", "status")`;
console.log("quote ensured");

// The loads a tenant runs itself live in "movement" and its six satellites,
// which create-movement-tables.mjs owns — one script per entity, and that one
// is long enough on its own. Run it too.

await sql`
    create table if not exists "notification" (
        "id" text primary key,
        "organization_id" text not null references "organization"("id") on delete cascade,
        "user_id" text not null references "user"("id") on delete cascade,
        "kind" text not null,
        "entity_type" text,
        "entity_id" text,
        "params" jsonb not null default '{}'::jsonb,
        "read_at" timestamp,
        "email_state" text not null default 'none',
        "email_attempts" integer not null default 0,
        "email_last_error" text,
        "dedupe_key" text,
        "created_at" timestamp not null default now()
    )`;

await sql`create index if not exists "notification_user_created_idx" on "notification" ("user_id", "created_at" desc nulls last)`;
await sql`create index if not exists "notification_user_unread_idx" on "notification" ("user_id") where "read_at" is null`;
// Idempotent materialization: the same source event can only ever produce one
// row per user
await sql`create unique index if not exists "notification_user_dedupe_uidx" on "notification" ("user_id", "dedupe_key") where "dedupe_key" is not null`;
await sql`create index if not exists "notification_email_pending_idx" on "notification" ("email_state") where "email_state" = 'pending'`;
console.log("notification ensured");

await sql`
    create table if not exists "notification_cursor" (
        "organization_id" text primary key references "organization"("id") on delete cascade,
        "last_history_created_at" timestamp not null,
        "updated_at" timestamp not null default now()
    )`;
console.log("notification_cursor ensured");

const tables = [
    "partner_connection",
    "organization_claim",
    "order_request",
    "quote",
    "trip",
    "trip_route",
    "trip_location",
    "trip_tracking_request",
    "notification",
    "notification_cursor",
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
