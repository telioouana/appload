/**
 * Creates the "activity_log" table (append-only user activity audit trail)
 * plus its indexes. Idempotent: exits early if the table already exists.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 *
 * Must stay in sync with packages/db/src/schemas/activity-log.ts.
 * Note: "id" has no DB default — the Drizzle $defaultFn generates it
 * app-side, matching ops_order.
 *
 * Usage:
 *   node packages/db/scripts/create-activity-log-table.mjs
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

const [{ exists }] = await sql`select to_regclass('activity_log') is not null as exists`;

if (exists) {
    console.log("activity_log already exists — nothing to do");
    process.exit(0);
}

await sql`
    create table "activity_log" (
        "id" text primary key,
        "action" text not null,
        "actor_id" text not null,
        "actor_name" text,
        "session_id" text,
        "organization_id" text,
        "entity_type" text,
        "entity_id" text,
        "params" jsonb not null default '{}'::jsonb,
        "status" text not null default 'success',
        "error_code" text,
        "ip_address" text,
        "user_agent" text,
        "city" text,
        "country" text,
        "created_at" timestamp not null default now()
    )`;

await sql`create index "activity_log_actor_created_idx" on "activity_log" ("actor_id", "created_at")`;
await sql`create index "activity_log_session_created_idx" on "activity_log" ("session_id", "created_at")`;
await sql`create index "activity_log_action_idx" on "activity_log" ("action")`;

const columns = await sql`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_name = 'activity_log'
    order by ordinal_position`;

console.log("activity_log created:");
console.table(columns);
