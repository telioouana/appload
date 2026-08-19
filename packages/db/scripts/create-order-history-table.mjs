/**
 * Creates the "order_history" table (append-only order event log) plus its
 * index. Idempotent: exits early if the table already exists.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 *
 * Must stay in sync with packages/db/src/schemas/order-history.ts.
 * Note: "id" has no DB default — the Drizzle $defaultFn generates it
 * app-side, matching activity_log.
 *
 * Usage:
 *   node packages/db/scripts/create-order-history-table.mjs
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

const [{ exists }] = await sql`select to_regclass('order_history') is not null as exists`;

if (exists) {
    console.log("order_history already exists — nothing to do");
    process.exit(0);
}

await sql`
    create table "order_history" (
        "id" text primary key,
        "order_id" text not null references "order"("id") on delete restrict,
        "actor_user_id" text references "user"("id") on delete set null,
        "kind" text not null,
        "from_status" order_status_enum,
        "to_status" order_status_enum,
        "changed_fields" jsonb,
        "metadata" jsonb not null default '{}'::jsonb,
        "created_at" timestamp not null default now()
    )`;

await sql`create index "order_history_order_created_idx" on "order_history" ("order_id", "created_at")`;

const columns = await sql`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_name = 'order_history'
    order by ordinal_position`;

console.log("order_history created:");
console.table(columns);
