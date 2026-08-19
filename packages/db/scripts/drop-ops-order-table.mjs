/**
 * Drops the legacy "ops_order" table (the schema's former `order_ai`), the
 * first-cut operations order table that the rich "order" table replaced.
 * Nothing references it any more: chat_conversation was repointed to
 * "order" (repoint-chat-conversation-fk.mjs) and no TS module imports it.
 * Idempotent: `drop table if exists ... cascade` (cascade takes the FKs
 * and the year/seq unique index with it).
 *
 * DESTRUCTIVE — the rows are gone for good. Check `select count(*) from
 * ops_order` first if in doubt.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * SHARED DEV DATABASE ONLY — production applies the generated drizzle
 * migration (0005_drop_ops_order) with `pnpm --filter @workspace/db
 * db:migrate` (see RELEASE.md); never run both against the same database.
 *
 * Must stay in sync with packages/db/src/schemas/orders.ts.
 *
 * Usage:
 *   node packages/db/scripts/drop-ops-order-table.mjs
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

const [{ exists }] = await sql`select to_regclass('ops_order') is not null as exists`;

if (!exists) {
    console.log("ops_order table not present — nothing to drop");
    process.exit(0);
}

const [{ count }] = await sql`select count(*)::int as count from "ops_order"`;
console.log(`ops_order rows about to be dropped: ${count}`);

await sql`drop table if exists "ops_order" cascade`;
console.log("ops_order table dropped");

const [{ gone }] = await sql`select to_regclass('ops_order') is null as gone`;
console.log("ops_order present after drop:", !gone);
