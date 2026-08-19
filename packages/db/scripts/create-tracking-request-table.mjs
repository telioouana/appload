/**
 * Creates the "tracking_request" table (driver location-request log for the
 * twice-daily tracking cron) plus its indexes. Idempotent: exits early if
 * the table already exists.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 *
 * Must stay in sync with packages/db/src/schemas/tracking-requests.ts.
 *
 * Usage:
 *   node packages/db/scripts/create-tracking-request-table.mjs
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

const [{ exists }] = await sql`select to_regclass('tracking_request') is not null as exists`;

if (exists) {
    console.log("tracking_request already exists — nothing to do");
    process.exit(0);
}

await sql`
    create table "tracking_request" (
        "id" text primary key,
        "order_id" text not null references "order"("id") on delete restrict,
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

await sql`create unique index "tracking_request_order_slot_attempt_uidx" on "tracking_request" ("order_id", "slot_date", "slot", "attempt")`;
await sql`create index "tracking_request_external_idx" on "tracking_request" ("external_id")`;

const columns = await sql`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_name = 'tracking_request'
    order by ordinal_position`;

console.log("tracking_request created:");
console.table(columns);
