/**
 * Creates the "fx_daily_rate" table (one USD→MZN / USD→ZAR quote per calendar
 * day; the KPIs page converts each trip's money at the rate of its loading
 * day).
 * Idempotent: `create … if not exists`.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * SHARED DEV DATABASE ONLY — production applies the generated drizzle
 * migration (packages/db/drizzle/0013_fx_daily_rate.sql) with
 * `pnpm --filter @workspace/db db:migrate` (see RELEASE.md); never run both
 * against the same database.
 *
 * Must stay in sync with packages/db/src/schemas/fx.ts (fxDailyRate).
 *
 * The table starts empty; fill it with
 * `node packages/db/scripts/seed-daily-rates.mjs --yes`.
 *
 * Usage:
 *   node packages/db/scripts/create-fx-daily-rate-table.mjs
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

await sql`
    create table if not exists "fx_daily_rate" (
        "day" date primary key,
        "usd_mzn" numeric(12, 6) not null,
        "usd_zar" numeric(12, 6) not null,
        "source" text not null,
        "quoted_on" date not null,
        "fetched_at" timestamp not null default now()
    )`;

console.log("fx_daily_rate ensured");

const columns = await sql`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_name = 'fx_daily_rate'
    order by ordinal_position`;

console.table(columns);

const [{ days, first, last }] = await sql`
    select count(*)::int as days, min(day) as first, max(day) as last from fx_daily_rate`;

console.log(days ? `${days} day(s) stored, ${first} → ${last}` : "no rates yet — run seed-daily-rates.mjs");
