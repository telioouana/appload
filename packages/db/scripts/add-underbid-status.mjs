/**
 * Adds the "underbid" value to order_status_enum — the terminal status for
 * a prospect/booked order the shipper gave to a cheaper competitor (distinct
 * from "cancelled", where the shipper no longer needs the trip).
 * Idempotent: `add value if not exists`.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * SHARED DEV DATABASE ONLY — production applies the generated drizzle
 * migration (0006_underbid_status) with `pnpm --filter @workspace/db
 * db:migrate` (see RELEASE.md); never run both against the same database.
 *
 * Must stay in sync with packages/db/src/types/index.ts (ORDER_STATUS).
 *
 * Usage:
 *   node packages/db/scripts/add-underbid-status.mjs
 * (reads DATABASE_URL from apps/admin-dev/.env or the environment)
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

    const env = fs.readFileSync(path.join(root, "apps/admin-dev/.env"), "utf8");
    const match = env.match(/^DATABASE_URL=(.+)$/m);

    if (!match) {
        throw new Error("DATABASE_URL not found in apps/admin-dev/.env or the environment");
    }

    return match[1].trim().replace(/^["']|["']$/g, "");
}

const sql = neon(databaseUrl());

const values = () => sql`
    select enumlabel
    from pg_enum
    where enumtypid = 'order_status_enum'::regtype
    order by enumsortorder
`;

const before = (await values()).map((row) => row.enumlabel);
console.log("order_status_enum before:", before.join(", "));

if (before.includes("underbid")) {
    console.log("underbid already present — nothing to do");
    process.exit(0);
}

await sql`alter type "public"."order_status_enum" add value if not exists 'underbid'`;

const after = (await values()).map((row) => row.enumlabel);
console.log("order_status_enum after:", after.join(", "));
