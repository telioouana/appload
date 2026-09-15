/**
 * Adds what the partner portal needs on the tables that already exist:
 * "order".source (which app the order was created in),
 * organization.subscription_expires_at and organization.portal_activated_at
 * (pro gating and "on the portal"), activity_log.app (admin vs portal rows),
 * plus the indexes the tenant-scoped lists read through.
 * Idempotent: `add column if not exists` / `create index if not exists`.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * SHARED DEV DATABASE ONLY — production applies the generated drizzle
 * migration (packages/db/drizzle/0014_portal.sql) with `pnpm --filter
 * @workspace/db db:migrate` (see RELEASE.md); never run both against the same
 * database.
 *
 * The portal's own tables are in create-portal-tables.mjs; run that one too.
 *
 * Must stay in sync with packages/db/src/schemas/orders.ts (order,
 * orderHistory, orderOffer), users.ts (organization) and activity-log.ts.
 *
 * Usage:
 *   node packages/db/scripts/add-portal-columns.mjs
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

for (const table of ["order", "order_history", "order_offer", "organization", "activity_log"]) {
    const [{ exists }] = await sql`select to_regclass(${`"${table}"`}) is not null as exists`;

    if (!exists) {
        throw new Error(`${table} table not found — this script expects the admin schema to exist`);
    }
}

// Every order that exists today was created in Admin, which is exactly what
// the default says — so the backfill is the default itself
await sql`alter table "order" add column if not exists "source" text not null default 'admin'`;
console.log("order.source ensured");

await sql`alter table "organization" add column if not exists "subscription_expires_at" timestamp`;
await sql`alter table "organization" add column if not exists "portal_activated_at" timestamp`;
console.log("organization portal columns ensured");

await sql`alter table "activity_log" add column if not exists "app" text`;
console.log("activity_log.app ensured");

// Tenant lists: one party's orders, newest loading date first
await sql`create index if not exists "order_shipper_loading_idx" on "order" ("shipper_id", "expected_loading_date")`;
await sql`create index if not exists "order_carrier_loading_idx" on "order" ("carrier_id", "expected_loading_date")`;
await sql`create index if not exists "order_status_idx" on "order" ("status")`;
// The portal materializes notifications by sweeping the trail by time
await sql`create index if not exists "order_history_created_idx" on "order_history" ("created_at")`;
// A carrier's own offers, the portal's quote list
await sql`create index if not exists "order_offer_carrier_status_idx" on "order_offer" ("carrier_id", "status")`;
console.log("portal indexes ensured");

const columns = await sql`
    select table_name, column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where (table_name = 'order' and column_name = 'source')
       or (table_name = 'organization' and column_name in ('subscription_expires_at', 'portal_activated_at'))
       or (table_name = 'activity_log' and column_name = 'app')
    order by table_name, column_name`;

console.table(columns);

const indexes = await sql`
    select tablename, indexname
    from pg_indexes
    where indexname in (
        'order_shipper_loading_idx',
        'order_carrier_loading_idx',
        'order_status_idx',
        'order_history_created_idx',
        'order_offer_carrier_status_idx'
    )
    order by tablename, indexname`;

console.table(indexes);
