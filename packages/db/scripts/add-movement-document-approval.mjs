/**
 * Adds the loading-photo approval columns to `movement_document`:
 * `approved_at` (null until somebody who answers for the load validates the
 * photo) and `approved_by`, an FK on `user` that goes null if the account is
 * removed — who approved is not worth losing the photo over.
 *
 * Nothing is backfilled: every paper already filed is a paper, not a photo,
 * and a photo nobody has looked at is exactly what null means. Idempotent:
 * `add column if not exists`, and the FK is only added when it is missing.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * SHARED DEV DATABASE ONLY — production applies the generated drizzle
 * migration (packages/db/drizzle/0017_movement_document_approval.sql) with
 * `pnpm --filter @workspace/db db:migrate` (see RELEASE.md); never run both
 * against the same database.
 *
 * Must stay in sync with packages/db/src/schemas/movements.ts
 * (movementDocument).
 *
 * Usage:
 *   node packages/db/scripts/add-movement-document-approval.mjs
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

const [{ exists }] = await sql`select to_regclass('"movement_document"') is not null as exists`;

if (!exists) {
    throw new Error("movement_document table not found — run create-movement-tables.mjs (or rename-trip-to-movement.mjs) first");
}

await sql`alter table "movement_document" add column if not exists "approved_at" timestamp`;
await sql`alter table "movement_document" add column if not exists "approved_by" text`;
console.log("movement_document.approved_at / approved_by ensured");

// `add constraint` has no `if not exists`, so the catalogue is asked first
const [{ constrained }] = await sql`
    select exists (
        select 1 from pg_constraint
        where conname = 'movement_document_approved_by_user_id_fk'
    ) as constrained`;

if (constrained) {
    console.log("movement_document_approved_by_user_id_fk already there");
} else {
    await sql`
        alter table "movement_document"
        add constraint "movement_document_approved_by_user_id_fk"
        foreign key ("approved_by") references "user" ("id") on delete set null`;
    console.log("movement_document_approved_by_user_id_fk added");
}

const columns = await sql`
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_name = 'movement_document'
    order by ordinal_position`;

console.table(columns);

const photos = await sql`
    select count(*)::int as photos, count("approved_at")::int as approved
    from "movement_document"
    where "type" = 'loading-photo' and "deleted_at" is null`;

console.table(photos);
