/**
 * Everything migration 0022_appload_partner adds, applied idempotently:
 *   - "movement"."order_id" text — the Appload order this row is the
 *     tenant's side of, FK to "order"("id") on delete set null
 *   - "movement"."reference" / "request_reference" text — the per-company
 *     reference and the REQ it was filed under while collecting offers
 *   - indexes "movement_order_idx", partial unique "movement_order_org_uidx"
 *     and partial unique "movement_reference_uidx"
 *   - table "organization_counter" — one row per (organization, kind, year)
 *     holding the last reference number handed out
 *
 * Nothing here touches "organization"."type": it is a text column, so
 * widening the vocabulary to "appload" is no DDL at all.
 *
 * Idempotent: `add column if not exists`, `create table if not exists`,
 * `create index if not exists`, and the catalogue is asked before the FK
 * (`add constraint` has no `if not exists`).
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * SHARED DEV DATABASE ONLY — production applies the generated drizzle
 * migration (packages/db/drizzle/0022_appload_partner.sql) with
 * `pnpm --filter @workspace/db db:migrate` (see RELEASE.md); never run both
 * against the same database.
 *
 * Must stay in sync with packages/db/src/schemas/movements.ts (movement,
 * organizationCounter).
 *
 * Usage:
 *   node packages/db/scripts/add-appload-partner-columns.mjs [--yes]
 *
 *   (no flag)   dry run — report what is already there and write nothing
 *   --yes       apply
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

const ASSUME_YES = process.argv.includes("--yes");

const url = databaseUrl();
const sql = neon(url);

/**
 * Safety rail. The generated migration is what production applies; running
 * both against one database leaves 0022 failing on its `add constraint`.
 */
const databaseName = decodeURIComponent(new URL(url).pathname.slice(1)).split("?")[0];
if (!/dev/i.test(databaseName)) {
    throw new Error(`refusing to run: DATABASE_URL names "${databaseName}", which is not a dev database`);
}

console.log(`database: ${databaseName}`);
console.log(ASSUME_YES ? "mode:     APPLY" : "mode:     DRY RUN — nothing is written");

for (const table of ["movement", "order", "organization"]) {
    const [{ exists }] = await sql`select to_regclass(${`"${table}"`}) is not null as exists`;

    if (!exists) {
        throw new Error(`${table} table not found — the base schema must exist first`);
    }
}

/** What of 0022 the database already carries — the plan, and then the proof. */
async function report(title) {
    const [columns, indexes] = await Promise.all([
        sql`
            select column_name, data_type, is_nullable
            from information_schema.columns
            where table_name = 'movement'
              and column_name in ('order_id', 'reference', 'request_reference')
            order by ordinal_position`,
        sql`
            select indexname
            from pg_indexes
            where tablename in ('movement', 'organization_counter')
              and indexname in ('movement_order_idx', 'movement_order_org_uidx', 'movement_reference_uidx', 'organization_counter_organization_id_kind_year_pk')
            order by 1`,
    ]);

    console.log(`\n--- ${title} ---`);
    console.table(columns);
    console.table(indexes);
}

await report("already there");

if (!ASSUME_YES) {
    console.log("\nNothing was written. Re-run with --yes to apply.");
    process.exit(0);
}

await sql`alter table "movement" add column if not exists "order_id" text`;
await sql`alter table "movement" add column if not exists "reference" text`;
await sql`alter table "movement" add column if not exists "request_reference" text`;
console.log("movement.order_id / reference / request_reference ensured");

// `add constraint` has no `if not exists`, so the catalogue is asked first
const [{ constrained }] = await sql`
    select exists (
        select 1 from pg_constraint
        where conname = 'movement_order_id_order_id_fk'
    ) as constrained`;

if (constrained) {
    console.log("movement_order_id_order_id_fk already there");
} else {
    await sql`
        alter table "movement"
        add constraint "movement_order_id_order_id_fk"
        foreign key ("order_id") references "order" ("id") on delete set null`;
    console.log("movement_order_id_order_id_fk added");
}

await sql`create index if not exists "movement_order_idx" on "movement" ("order_id")`;
await sql`
    create unique index if not exists "movement_order_org_uidx"
    on "movement" ("order_id", "organization_id")
    where "order_id" is not null and "status" <> 'cancelled'`;
await sql`
    create unique index if not exists "movement_reference_uidx"
    on "movement" ("organization_id", "reference")
    where "reference" is not null`;
console.log("movement order / reference indexes ensured");

await sql`
    create table if not exists "organization_counter" (
        "organization_id" text not null references "organization" ("id") on delete cascade,
        "kind" text not null,
        "year" integer not null,
        "last" integer default 0 not null,
        constraint "organization_counter_organization_id_kind_year_pk" primary key ("organization_id", "kind", "year")
    )`;
console.log("organization_counter ensured");

await report("done");
