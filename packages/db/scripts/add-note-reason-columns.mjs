/**
 * Structured reasons for debit/credit notes on "order_document":
 *   - "reason_code" text — the cause (NOTE_REASON in the schema; the note
 *     type gives the direction), nullable so notes recorded before the
 *     vocabulary keep only their free-text description
 *   - "details" jsonb — reason particulars (demurrage stage + days, damage
 *     share + claim) that also land on the order row
 * Idempotent: `add column if not exists`. No CHECK change — the requirement
 * is enforced server-side so legacy notes need no backfill.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * SHARED DEV DATABASE ONLY — production applies the generated drizzle
 * migration with `pnpm --filter @workspace/db db:migrate` (see RELEASE.md);
 * never run both against the same database.
 *
 * Must stay in sync with packages/db/src/schemas/orders.ts.
 *
 * Usage:
 *   node packages/db/scripts/add-note-reason-columns.mjs
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

const [{ exists }] = await sql`select to_regclass('order_document') is not null as exists`;

if (!exists) {
    throw new Error("order_document table not found — run create-order-document-table.mjs first");
}

await sql`alter table "order_document" add column if not exists "reason_code" text`;
await sql`alter table "order_document" add column if not exists "details" jsonb`;
console.log("order_document.reason_code / details ensured");

const columns = await sql`
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_name = 'order_document'
      and column_name in ('reason', 'reason_code', 'details')
    order by ordinal_position`;

console.log("order_document note columns:");
console.table(columns);
