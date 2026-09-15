/**
 * Creates the seven tables of the dispatch-papers / loading-check / chat
 * feature: order_dispatch, order_dispatch_document, order_loading_check,
 * thread, thread_participant, thread_read, thread_message.
 *
 * Idempotent: `create table if not exists`, `create index if not exists`.
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * SHARED DEV DATABASE ONLY — production applies the generated drizzle
 * migration (packages/db/drizzle/0021_dispatch_check_threads.sql) with
 * `pnpm --filter @workspace/db db:migrate` (see RELEASE.md); never run both
 * against the same database.
 *
 * Must stay in sync with packages/db/src/schemas/orders.ts (orderDispatch,
 * orderDispatchDocument, orderLoadingCheck) and schemas/threads.ts.
 *
 * Usage:
 *   node packages/db/scripts/create-dispatch-check-thread-tables.mjs
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

for (const table of ["order", "driver", "user", "organization"]) {
    const [{ exists }] = await sql`select to_regclass(${`"${table}"`}) is not null as exists`;

    if (!exists) {
        throw new Error(`${table} table not found — the base schema must exist first`);
    }
}

await sql`
    create table if not exists "order_dispatch" (
        "id" text primary key not null,
        "order_id" text not null references "order" ("id") on delete restrict,
        "driver_id" text references "driver" ("id") on delete set null,
        "driver_name" text,
        "driver_phone_number" text,
        "driver_passport" text,
        "truck_id" text,
        "trailer_id" text,
        "link_id" text,
        "truck_plate" text,
        "trailer_plate" text,
        "link_plate" text,
        "dispatched_by" text references "user" ("id") on delete set null,
        "dispatched_at" timestamp default now() not null,
        "superseded_at" timestamp,
        "superseded_by" text references "user" ("id") on delete set null
    )`;
await sql`create index if not exists "order_dispatch_order_idx" on "order_dispatch" ("order_id", "dispatched_at")`;
await sql`create unique index if not exists "order_dispatch_open_uidx" on "order_dispatch" ("order_id") where "superseded_at" is null`;
console.log("order_dispatch ensured");

await sql`
    create table if not exists "order_dispatch_document" (
        "dispatch_id" text not null references "order_dispatch" ("id") on delete cascade,
        "subject_type" text not null,
        "subject_id" text not null,
        "kyc_document_id" text not null,
        "type" text not null,
        "status_at_snapshot" text not null,
        "expires_at" date,
        constraint "order_dispatch_document_dispatch_id_kyc_document_id_pk" primary key ("dispatch_id", "kyc_document_id")
    )`;
await sql`create index if not exists "order_dispatch_document_kyc_idx" on "order_dispatch_document" ("kyc_document_id")`;
console.log("order_dispatch_document ensured");

await sql`
    create table if not exists "order_loading_check" (
        "id" text primary key not null,
        "order_id" text not null references "order" ("id") on delete restrict,
        "dispatch_id" text references "order_dispatch" ("id") on delete restrict,
        "items" jsonb default '[]'::jsonb not null,
        "outcome" text not null,
        "photo_document_ids" jsonb default '[]'::jsonb not null,
        "note" text,
        "checked_by" text references "user" ("id") on delete set null,
        "checked_by_org_id" text references "organization" ("id") on delete set null,
        "checked_at" timestamp default now() not null
    )`;
await sql`create index if not exists "order_loading_check_order_idx" on "order_loading_check" ("order_id", "checked_at")`;
console.log("order_loading_check ensured");

await sql`
    create table if not exists "thread" (
        "id" text primary key not null,
        "subject_type" text not null,
        "subject_id" text not null,
        "created_at" timestamp default now() not null,
        "last_message_at" timestamp
    )`;
await sql`create unique index if not exists "thread_subject_uidx" on "thread" ("subject_type", "subject_id")`;
console.log("thread ensured");

await sql`
    create table if not exists "thread_participant" (
        "id" text primary key not null,
        "thread_id" text not null references "thread" ("id") on delete cascade,
        "organization_id" text references "organization" ("id") on delete cascade,
        "staff" boolean default false not null
    )`;
await sql`create unique index if not exists "thread_participant_org_uidx" on "thread_participant" ("thread_id", "organization_id") where "organization_id" is not null`;
await sql`create unique index if not exists "thread_participant_staff_uidx" on "thread_participant" ("thread_id") where "staff"`;
await sql`create index if not exists "thread_participant_org_idx" on "thread_participant" ("organization_id")`;
console.log("thread_participant ensured");

await sql`
    create table if not exists "thread_read" (
        "thread_id" text not null references "thread" ("id") on delete cascade,
        "user_id" text not null references "user" ("id") on delete cascade,
        "last_read_at" timestamp default now() not null,
        constraint "thread_read_thread_id_user_id_pk" primary key ("thread_id", "user_id")
    )`;
console.log("thread_read ensured");

await sql`
    create table if not exists "thread_message" (
        "id" text primary key not null,
        "thread_id" text not null references "thread" ("id") on delete cascade,
        "sender_user_id" text references "user" ("id") on delete set null,
        "sender_org_id" text references "organization" ("id") on delete set null,
        "body" text default '' not null,
        "attachments" jsonb default '[]'::jsonb not null,
        "created_at" timestamp default now() not null,
        constraint "thread_message_content_chk" check (length("body") > 0 or jsonb_array_length("attachments") > 0)
    )`;
await sql`create index if not exists "thread_message_thread_created_idx" on "thread_message" ("thread_id", "created_at")`;
console.log("thread_message ensured");

const tables = await sql`
    select table_name, (select count(*) from information_schema.columns c where c.table_name = t.table_name)::int as columns
    from information_schema.tables t
    where table_schema = 'public'
      and table_name in ('order_dispatch', 'order_dispatch_document', 'order_loading_check', 'thread', 'thread_participant', 'thread_read', 'thread_message')
    order by 1`;

console.table(tables);
