/**
 * Creates the "order_document" table (polymorphic order documents and
 * debit/credit notes, soft-deleted) plus its index and CHECK, and adds
 * the per-party note-sum columns to "order". Idempotent throughout.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 *
 * Must stay in sync with packages/db/src/schemas/order-documents.ts and
 * the adjustment columns in packages/db/src/schemas/orders.ts.
 *
 * Usage:
 *   node packages/db/scripts/create-order-document-table.mjs
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

await sql`alter table "order" add column if not exists "shipper_debit_total" numeric(14,2) not null default 0`;
await sql`alter table "order" add column if not exists "shipper_credit_total" numeric(14,2) not null default 0`;
await sql`alter table "order" add column if not exists "carrier_debit_total" numeric(14,2) not null default 0`;
await sql`alter table "order" add column if not exists "carrier_credit_total" numeric(14,2) not null default 0`;
console.log("order adjustment columns ensured");

const [{ exists }] = await sql`select to_regclass('order_document') is not null as exists`;

if (exists) {
    console.log("order_document already exists — nothing more to do");
    process.exit(0);
}

await sql`
    create table "order_document" (
        "id" text primary key,
        "order_id" text not null references "order"("id") on delete restrict,
        "type" text not null,
        "party" text,
        "title" text,
        "url" text not null,
        "size" integer,
        "mime_type" text,
        "subtotal" numeric(14,2),
        "vat" numeric(14,2),
        "total" numeric(14,2),
        "currency" currency_enum,
        "reason" text,
        "uploaded_by" text references "user"("id") on delete set null,
        "deleted_at" timestamp,
        "deleted_by" text references "user"("id") on delete set null,
        "created_at" timestamp not null default now(),
        constraint "order_document_note_fields_chk"
            check ("type" not in ('debit-note', 'credit-note') or ("party" is not null and "total" is not null))
    )`;

await sql`create index "order_document_order_type_idx" on "order_document" ("order_id", "type")`;

const columns = await sql`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_name = 'order_document'
    order by ordinal_position`;

console.log("order_document created:");
console.table(columns);
