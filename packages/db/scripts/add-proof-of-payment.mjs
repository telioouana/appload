/**
 * Proof-of-payment support on "order_document":
 *   - adds the nullable "paid_at" timestamp column (bank value date)
 *   - widens the "order_document_note_fields_chk" CHECK so proofs of
 *     payment need a party, a total (amount paid) and a paid_at, on top of
 *     the existing rule for debit/credit notes
 * Idempotent: `add column if not exists`, and the constraint is dropped and
 * re-added in one transaction (Postgres has no ADD CONSTRAINT IF NOT EXISTS).
 * Safe on existing rows — the new predicates only bite type =
 * 'proof-of-payment', which has none yet.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * SHARED DEV DATABASE ONLY — production applies the generated drizzle
 * migration with `pnpm --filter @workspace/db db:migrate` (see RELEASE.md);
 * never run both against the same database.
 *
 * Must stay in sync with packages/db/src/schemas/orders.ts
 * (orderDocument.paidAt + order_document_note_fields_chk).
 *
 * Usage:
 *   node packages/db/scripts/add-proof-of-payment.mjs
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

await sql`alter table "order_document" add column if not exists "paid_at" timestamp`;
console.log("order_document.paid_at ensured");

// Drop + add in one transaction so the table is never left without the check
await sql.transaction([
    sql`alter table "order_document" drop constraint if exists "order_document_note_fields_chk"`,
    sql`alter table "order_document" add constraint "order_document_note_fields_chk"
        check (
            ("type" not in ('debit-note', 'credit-note', 'proof-of-payment') or ("party" is not null and "total" is not null))
            and ("type" <> 'proof-of-payment' or "paid_at" is not null)
        )`,
]);
console.log("order_document_note_fields_chk widened for proof-of-payment");

const columns = await sql`
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_name = 'order_document'
      and column_name in ('party', 'total', 'currency', 'reason', 'paid_at')
    order by ordinal_position`;

const [check] = await sql`
    select pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conname = 'order_document_note_fields_chk'`;

console.log("order_document money columns:");
console.table(columns);
console.log("order_document_note_fields_chk:", check?.definition);
