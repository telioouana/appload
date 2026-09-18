/**
 * Adds the pricing columns to "order_offer" — Appload's commission on top of
 * the quote and the resulting client price — and fills them on the rows the
 * backfill wrote before they existed, from the order row they mirror.
 * Idempotent: `add column if not exists`, and the fill only touches rows
 * still lacking a commission.
 *
 * Applied with targeted SQL on purpose: drizzle-kit push is unsafe against
 * the shared database. SHARED DEV DATABASE ONLY — production applies the
 * generated drizzle migration (packages/db/drizzle/0012_*) with
 * `pnpm --filter @workspace/db db:migrate` and gets these values from
 * backfill-order-offers.mjs, which writes them from the start (see
 * RELEASE.md); never run both against the same database.
 *
 * Must stay in sync with packages/db/src/schemas/orders.ts (orderOffer).
 *
 * Usage:
 *   node packages/db/scripts/add-order-offer-pricing-columns.mjs
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

const [{ exists }] = await sql`select to_regclass('order_offer') is not null as exists`;

if (!exists) {
    throw new Error("order_offer table not found — run create-order-offer-table.mjs first");
}

for (const column of ["commission_subtotal", "commission_vat", "commission_total", "client_subtotal", "client_vat", "client_total"]) {
    await sql.query(`alter table order_offer add column if not exists "${column}" numeric(14, 2)`);
}
console.log("order_offer pricing columns ensured");

// Rows the backfill wrote mirror their order's carrier leg, so the order's
// commission and shipper leg are their pricing. Hand-written offers with no
// commission stay null: the operator prices them through the offer dialog.
const filled = await sql`
    update order_offer f
    set commission_subtotal = o.appload_commission_subtotal,
        commission_vat = o.appload_commission_vat,
        commission_total = o.appload_commission_total,
        client_subtotal = o.shipper_subtotal,
        client_vat = o.shipper_vat,
        client_total = o.shipper_total
    from "order" o
    where o.id = f.order_id
      and f.created_by is null
      and f.commission_total is null
      and o.appload_commission_total is not null
    returning f.id`;

console.log(`filled pricing on ${filled.length} backfilled offer(s)`);

const summary = await sql`
    select status,
           count(*)::int as offers,
           count(commission_total)::int as priced
    from order_offer
    group by status
    order by status`;

console.table(summary);
