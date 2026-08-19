/**
 * Creates the "kyc_document" table (polymorphic verification documents,
 * append-only, soft-deleted) and adds the verification/risk/ownership
 * columns to "organization", "driver", "truck", "trailer" and "link".
 * Idempotent throughout — safe to re-run.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * Every new vocabulary is a plain text column, never a pg enum, so adding a
 * document type later never needs an ALTER TYPE.
 *
 * Must stay in sync with packages/db/src/schemas/kyc-documents.ts and the
 * new columns in packages/db/src/schemas/{users,fleet}.ts.
 *
 * Usage:
 *   node packages/db/scripts/create-kyc-tables.mjs
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

// --- organization: verification + risk -------------------------------------

await sql`alter table "organization" add column if not exists "kyc_status" text not null default 'draft'`;
await sql`alter table "organization" add column if not exists "risk_level" text not null default 'none'`;
await sql`alter table "organization" add column if not exists "risk_reason" text`;
await sql`alter table "organization" add column if not exists "risk_flagged_at" timestamp`;
await sql`alter table "organization" add column if not exists "risk_flagged_by" text`;
console.log("organization verification + risk columns ensured");

// --- driver: verification --------------------------------------------------

await sql`alter table "driver" add column if not exists "kyc_status" text not null default 'draft'`;
console.log("driver verification column ensured");

// --- vehicles: verification + ownership ------------------------------------

await sql`alter table "truck" add column if not exists "kyc_status" text not null default 'draft'`;
await sql`alter table "truck" add column if not exists "ownership_status" text not null default 'unverified'`;
await sql`alter table "truck" add column if not exists "owner_name" text`;
await sql`alter table "truck" add column if not exists "owner_nuit" text`;

await sql`alter table "trailer" add column if not exists "kyc_status" text not null default 'draft'`;
await sql`alter table "trailer" add column if not exists "ownership_status" text not null default 'unverified'`;
await sql`alter table "trailer" add column if not exists "owner_name" text`;
await sql`alter table "trailer" add column if not exists "owner_nuit" text`;

await sql`alter table "link" add column if not exists "kyc_status" text not null default 'draft'`;
await sql`alter table "link" add column if not exists "ownership_status" text not null default 'unverified'`;
await sql`alter table "link" add column if not exists "owner_name" text`;
await sql`alter table "link" add column if not exists "owner_nuit" text`;
console.log("truck/trailer/link verification + ownership columns ensured");

// --- kyc_document ----------------------------------------------------------

const [{ exists }] = await sql`select to_regclass('kyc_document') is not null as exists`;

if (exists) {
    console.log("kyc_document already exists — nothing more to do");
    process.exit(0);
}

// No foreign key on (subject_type, subject_id): five different tables can own
// a document, and the trail must survive a cascade delete of its subject.
await sql`
    create table "kyc_document" (
        "id" text primary key,
        "subject_type" text not null,
        "subject_id" text not null,
        "type" text not null,
        "pages" jsonb not null,
        "status" text not null default 'pending',
        "issued_at" date,
        "expires_at" date,
        "document_number" text,
        "reviewed_by" text,
        "reviewed_at" timestamp,
        "rejection_reason" text,
        "supersedes_id" text,
        "uploaded_by" text not null,
        "created_at" timestamp not null default now(),
        "deleted_at" timestamp,
        "deleted_by" text
    )`;

await sql`create index "kyc_document_subject_idx" on "kyc_document" ("subject_type", "subject_id")`;
await sql`create index "kyc_document_status_idx" on "kyc_document" ("status")`;
await sql`create index "kyc_document_expiry_idx" on "kyc_document" ("expires_at")`;

const columns = await sql`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_name = 'kyc_document'
    order by ordinal_position`;

console.log("kyc_document created:");
console.table(columns);
