/**
 * Adds `place_label` to `order_location` and `movement_location`: the
 * "District or city, Province, Country" reverse-geocoded from a ping's
 * coordinates, which the map's table view shows as the place.
 *
 * Nothing is backfilled here: a null label is what "not resolved yet" means,
 * and the map overview fills old pins lazily the first time it reads them
 * (packages/domain/src/tracking/place-labels.ts), which keeps the Google
 * calls to the pins somebody actually looks at. Idempotent: `add column if
 * not exists`.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database (it would try to reshape unrelated legacy tables).
 * SHARED DEV DATABASE ONLY — production applies the generated drizzle
 * migration (packages/db/drizzle/0020_location_place_label.sql) with
 * `pnpm --filter @workspace/db db:migrate` (see RELEASE.md); never run both
 * against the same database.
 *
 * Must stay in sync with packages/db/src/schemas/tracking.ts (orderLocation)
 * and movements.ts (movementLocation).
 *
 * Usage:
 *   node packages/db/scripts/add-location-place-label.mjs
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

const [{ orders, movements }] = await sql`
    select to_regclass('"order_location"') is not null as orders,
           to_regclass('"movement_location"') is not null as movements`;

if (!orders || !movements) {
    throw new Error("order_location / movement_location not found — run create-order-tracking-tables.mjs and create-movement-tables.mjs first");
}

await sql`alter table "order_location" add column if not exists "place_label" text`;
await sql`alter table "movement_location" add column if not exists "place_label" text`;
console.log("order_location.place_label / movement_location.place_label ensured");

const columns = await sql`
    select table_name, column_name, data_type, is_nullable
    from information_schema.columns
    where table_name in ('order_location', 'movement_location') and column_name in ('place_name', 'place_label')
    order by table_name, column_name`;

console.table(columns);

const pings = await sql`
    select 'order_location' as "table", count(*)::int as pings, count("place_label")::int as labelled from "order_location"
    union all
    select 'movement_location', count(*)::int, count("place_label")::int from "movement_location"`;

console.table(pings);
