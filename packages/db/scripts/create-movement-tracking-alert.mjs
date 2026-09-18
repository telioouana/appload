/**
 * Creates `movement_tracking_alert`: one row per slot a movement's tracking
 * failed in — the driver sent nothing, barely moved, or picked an address off
 * his phone instead of sharing where the truck is. The unique index on
 * (movement_id, slot_date, slot) is what makes the review idempotent, so it
 * matters as much as the table.
 *
 * Nothing is backfilled: an alert is a judgement about a window that has
 * already closed, and there is no record of who answered which of yesterday's
 * slots to reconstruct one from. Idempotent: `create table if not exists` /
 * `create index if not exists`.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * SHARED DEV DATABASE ONLY — production applies the generated drizzle
 * migration (packages/db/drizzle/0018_movement_tracking_alert.sql) with
 * `pnpm --filter @workspace/db db:migrate` (see RELEASE.md); never run both
 * against the same database.
 *
 * Must stay in sync with packages/db/src/schemas/movements.ts
 * (movementTrackingAlert).
 *
 * Usage:
 *   node packages/db/scripts/create-movement-tracking-alert.mjs
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
    create table if not exists "movement_tracking_alert" (
        "id" text primary key not null,
        "movement_id" text not null references "movement" ("id") on delete restrict,
        "slot_date" text not null,
        "slot" text not null,
        "issue" text not null,
        "streak" integer not null,
        "created_at" timestamp default now() not null
    )`;
console.log("movement_tracking_alert ensured");

// One alert per slot: every later tick of the same window writes nothing, and
// the next slot reads this row to know whether it is the second in a row
await sql`create unique index if not exists "movement_tracking_alert_slot_uidx" on "movement_tracking_alert" ("movement_id", "slot_date", "slot")`;
console.log("movement_tracking_alert_slot_uidx ensured");

const columns = await sql`
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_name = 'movement_tracking_alert'
    order by ordinal_position`;

console.table(columns);

const alerts = await sql`
    select "issue", count(*)::int as alerts, max("streak")::int as longest_streak
    from "movement_tracking_alert"
    group by 1
    order by 1`;

console.table(alerts);
