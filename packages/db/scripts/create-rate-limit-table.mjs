/**
 * Creates the "rate_limit" table (Better Auth's database-backed rate-limit
 * storage — see rateLimit in packages/auth/src/server.ts). Idempotent.
 *
 * Only needed on databases that predate the baseline migration in
 * packages/db/drizzle (the shared dev database); fresh databases get the
 * table from `pnpm --filter @workspace/db db:migrate`.
 *
 * Usage:
 *   node packages/db/scripts/create-rate-limit-table.mjs
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

await sql`create table if not exists "rate_limit" (
    "id" text primary key,
    "key" text,
    "count" integer,
    "last_request" bigint
)`;
await sql`create index if not exists "rateLimit_key_idx" on "rate_limit" ("key")`;

console.log("rate_limit table is in place.");
