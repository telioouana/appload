/**
 * Applies subscription model v2: the subscription_usage table and its two
 * indexes (one row per organization per tracked movement), organization
 * .subscription_plan losing its "free" default and its NOT NULL (null = no
 * plan agreed yet), and the remap of the two old plan names onto the tiers.
 * Idempotent: `create table if not exists` / `create index if not exists`,
 * DROP DEFAULT / DROP NOT NULL are no-ops once applied, and the remap only
 * touches rows still holding a legacy value.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * SHARED DEV DATABASE ONLY — production applies the generated drizzle
 * migration (packages/db/drizzle/0015_subscription.sql) with `pnpm --filter
 * @workspace/db db:migrate` (see RELEASE.md); never run both against the same
 * database.
 *
 * Must stay in sync with packages/db/src/schemas/subscriptions.ts
 * (subscriptionUsage) and users.ts (organization).
 *
 * Usage:
 *   node packages/db/scripts/add-subscription-usage.mjs
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

const [{ exists }] = await sql`select to_regclass('"organization"') is not null as exists`;

if (!exists) {
    throw new Error("organization table not found — this script expects the admin schema to exist");
}

await sql`
    create table if not exists "subscription_usage" (
        "id" text primary key not null,
        "organization_id" text not null references "organization" ("id") on delete cascade,
        "period" text not null,
        "entity_type" text not null,
        "entity_id" text not null,
        "created_at" timestamp default now() not null
    )`;
console.log("subscription_usage ensured");

// One movement is only ever billed once, which is what makes a re-dispatch free
await sql`create unique index if not exists "subscription_usage_entity_uq" on "subscription_usage" ("organization_id", "entity_type", "entity_id")`;
await sql`create index if not exists "subscription_usage_period_idx" on "subscription_usage" ("organization_id", "period")`;
console.log("subscription_usage indexes ensured");

await sql`alter table "organization" alter column "subscription_plan" drop default`;
await sql`alter table "organization" alter column "subscription_plan" drop not null`;
console.log("organization.subscription_plan is nullable with no default");

// The old vocabulary: everyone was "free" (no plan agreed), and the handful of
// "pro" rows sit closest to the middle tier
const remapped = await sql`
    update "organization"
    set "subscription_plan" = case "subscription_plan" when 'pro' then 'business' else null end
    where "subscription_plan" in ('free', 'pro')
    returning "id"`;

console.log(`organization rows remapped: ${remapped.length}`);

const columns = await sql`
    select table_name, column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where (table_name = 'organization' and column_name = 'subscription_plan')
       or table_name = 'subscription_usage'
    order by table_name, column_name`;

console.table(columns);

const plans = await sql`
    select coalesce("subscription_plan", '(none)') as plan, count(*)::int as organizations
    from "organization"
    group by 1
    order by 1`;

console.table(plans);
