/**
 * Applies the portal's movement chain and its disputes: `movement.resume_status`
 * (where a stopped load, or one with an issue, goes back to), the
 * `movement_dispute` and `movement_dispute_row` tables with their indexes, and
 * `movement_driver_phone_idx` recreated so the tracking cron's working set is
 * every in-progress status instead of "in-transit". Then the data: the removed
 * "in-transit" status becomes "on-route" on the movement rows and on both
 * status columns of their trail, and the roll-up at the end prints what is
 * left of it (must be 0 everywhere).
 *
 * Idempotent: `add column if not exists` / `create table if not exists` /
 * `create index if not exists`, the tracking index is only recreated while it
 * still has the old definition, and the updates only touch rows still holding
 * "in-transit".
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * SHARED DEV DATABASE ONLY — production applies the generated drizzle
 * migration (packages/db/drizzle/0019_movement_chain_disputes.sql) with
 * `pnpm --filter @workspace/db db:migrate` (see RELEASE.md); never run both
 * against the same database.
 *
 * Must stay in sync with packages/db/src/schemas/movements.ts (movement,
 * movementDispute, movementDisputeRow).
 *
 * Usage:
 *   node packages/db/scripts/add-movement-chain-disputes.mjs
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

await sql`alter table "movement" add column if not exists "resume_status" text`;
console.log("movement.resume_status ensured");

// Constraint names spelled the way drizzle-kit names them in 0019, so the dev
// database and production end up with the same catalogue
await sql`
    create table if not exists "movement_dispute" (
        "id" text primary key not null,
        "movement_id" text not null,
        "opened_by_org_id" text not null,
        "opened_by" text,
        "party_org_ids" text[] default '{}' not null,
        "reason" text not null,
        "description" text not null,
        "status" text default 'open' not null,
        "resolution" text,
        "resolved_by" text,
        "opened_at" timestamp default now() not null,
        "resolved_at" timestamp,
        "created_at" timestamp default now() not null,
        "updated_at" timestamp default now() not null,
        constraint "movement_dispute_movement_id_movement_id_fk"
            foreign key ("movement_id") references "movement" ("id") on delete restrict,
        constraint "movement_dispute_opened_by_org_id_organization_id_fk"
            foreign key ("opened_by_org_id") references "organization" ("id"),
        constraint "movement_dispute_opened_by_user_id_fk"
            foreign key ("opened_by") references "user" ("id") on delete set null,
        constraint "movement_dispute_resolved_by_user_id_fk"
            foreign key ("resolved_by") references "user" ("id") on delete set null
    )`;
// Added after the table was first created here, so the dev database needs it
// on its own line: who a dispute is announced to, pinned when it is opened
await sql`alter table "movement_dispute" add column if not exists "party_org_ids" text[] default '{}' not null`;
console.log("movement_dispute ensured");

await sql`
    create table if not exists "movement_dispute_row" (
        "dispute_id" text not null,
        "movement_id" text not null,
        "open" boolean default true not null,
        constraint "movement_dispute_row_dispute_id_movement_id_pk" primary key ("dispute_id", "movement_id"),
        constraint "movement_dispute_row_dispute_id_movement_dispute_id_fk"
            foreign key ("dispute_id") references "movement_dispute" ("id") on delete cascade,
        constraint "movement_dispute_row_movement_id_movement_id_fk"
            foreign key ("movement_id") references "movement" ("id") on delete restrict
    )`;
console.log("movement_dispute_row ensured");

await sql`create index if not exists "movement_dispute_movement_idx" on "movement_dispute" ("movement_id")`;
// One open dispute per row across the whole chain: a second open is a unique
// violation, not a race
await sql`create unique index if not exists "movement_dispute_row_open_uidx" on "movement_dispute_row" ("movement_id") where "open"`;
console.log("movement_dispute indexes ensured");

// `create index if not exists` would keep the old predicate, so the index is
// replaced while its definition still reads "in-transit" (or it is missing)
const [phoneIndex] = await sql`select indexdef from pg_indexes where indexname = 'movement_driver_phone_idx'`;

if (phoneIndex && phoneIndex.indexdef.includes("at-loading")) {
    console.log("movement_driver_phone_idx already covers the in-progress statuses");
} else {
    await sql`drop index if exists "movement_driver_phone_idx"`;
    await sql`
        create index "movement_driver_phone_idx" on "movement" ("driver_phone")
        where status in ('at-loading','loading','waiting-documents','on-route','stopped','issue','at-border','at-offloading','offloading') and execution_movement_id is null`;
    console.log("movement_driver_phone_idx recreated over the in-progress statuses");
}

// A load that was "in-transit" had left the loading site: on the new chain
// that is on-route
const movements = await sql`update "movement" set "status" = 'on-route' where "status" = 'in-transit' returning "id"`;
const toStatuses = await sql`update "movement_event" set "to_status" = 'on-route' where "to_status" = 'in-transit' returning "id"`;
const fromStatuses = await sql`update "movement_event" set "from_status" = 'on-route' where "from_status" = 'in-transit' returning "id"`;

console.log(`movement rows remapped: ${movements.length}`);
console.log(`movement_event to_status remapped: ${toStatuses.length}`);
console.log(`movement_event from_status remapped: ${fromStatuses.length}`);

const [{ indexdef }] = await sql`select indexdef from pg_indexes where indexname = 'movement_driver_phone_idx'`;
console.log(indexdef);

const statuses = await sql`
    select "status", count(*)::int as movements
    from "movement"
    group by 1
    order by 1`;

console.table(statuses);

const remaining = await sql`
    select
        (select count(*)::int from "movement" where "status" = 'in-transit') as movement_status,
        (select count(*)::int from "movement_event" where "to_status" = 'in-transit') as event_to_status,
        (select count(*)::int from "movement_event" where "from_status" = 'in-transit') as event_from_status`;

console.log("remaining in-transit (must be 0):");
console.table(remaining);
