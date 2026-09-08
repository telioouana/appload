/**
 * Backfills "order_offer" from the carrier leg already written on the order
 * rows, so the offers card is not empty for the whole history the day the
 * feature ships.
 *
 * Every order with a carrier and no offer yet gets exactly one offer copied
 * from the row: carrier, fiscal regime, the carrier price and its currency.
 * A booked-or-later order (anything but a prospect) gets it as `accepted`
 * decided on the deal date — that offer is what booked it, retroactively;
 * a prospect that already names a carrier gets it as `pending`, still to be
 * decided. Nothing on the order itself is edited: the accepted offer states
 * what the row already says.
 *
 * `includes_git`/`includes_gps` are false and `notes` null everywhere: what
 * an old quote covered was never recorded, and guessing it would put
 * invented commitments in front of Claire.
 *
 * The two snapshots are computed as of the deal, not as of today:
 *   carrier_since  least(the organization's created_at, its earliest order) —
 *                  parties imported by the logbook sync carry the sync's wall
 *                  clock as created_at, so their first order is the honest
 *                  date
 *   carrier_trips  that carrier's delivered/completed orders dealt before this
 *                  one — the same clock as the runtime snapshot
 *                  (apps/admin/src/lib/orders/carrier-snapshot.ts), so a
 *                  backfilled offer and one written today can be compared
 *
 * Idempotent: orders that already have an offer are excluded from the plan
 * and from the insert.
 *
 * Usage:
 *   node packages/db/scripts/backfill-order-offers.mjs [--dry] [--yes]
 *
 *   --dry (the default)  report the plan and write nothing
 *   --yes                write
 * (reads DATABASE_URL from apps/admin/.env or the environment)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const ASSUME_YES = process.argv.includes("--yes");

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

// One CTE so the plan and the insert see exactly the same rows and compute
// the same snapshots.
const PLANNED = `
with planned as (
    select o.id                                                as order_uuid,
           o.order_id                                          as human_order_id,
           o.status                                            as order_status,
           o.carrier_id                                        as carrier_id,
           coalesce(o.carrier_name, org.name)                  as carrier_name,
           coalesce(o.fiscal_regime, 'n/a'::fiscal_regime_enum) as fiscal_regime,
           o.carrier_subtotal                                  as subtotal,
           o.carrier_vat                                       as vat,
           coalesce(o.carrier_total, 0)                        as total,
           o.carrier_total is null                             as total_defaulted,
           coalesce(o.carrier_currency, 'MZN'::currency_enum)  as currency,
           o.appload_commission_subtotal                       as commission_subtotal,
           o.appload_commission_vat                            as commission_vat,
           o.appload_commission_total                          as commission_total,
           o.shipper_subtotal                                  as client_subtotal,
           o.shipper_vat                                       as client_vat,
           o.shipper_total                                     as client_total,
           case when o.status = 'prospect' then 'pending' when o.status = 'underbid' then 'lost' else 'accepted' end as offer_status,
           coalesce(o.deal_date, o.created_at)                 as decided_at,
           least(org.created_at, first_order.first_at)         as carrier_since,
           coalesce(trips.done, 0)                             as carrier_trips
    from "order" o
    join organization org on org.id = o.carrier_id
    left join lateral (
        select min(c.created_at) as first_at
        from "order" c
        where c.carrier_id = o.carrier_id
    ) first_order on true
    left join lateral (
        select count(*) as done
        from "order" c
        where c.carrier_id = o.carrier_id
          and c.status in ('delivered', 'completed')
          and coalesce(c.deal_date, c.created_at) < coalesce(o.deal_date, o.created_at)
    ) trips on true
    where o.carrier_id is not null
      and not exists (select 1 from order_offer f where f.order_id = o.id)
)`;

const plan = await sql.query(`${PLANNED}
select * from planned order by human_order_id`);

if (plan.length === 0) {
    console.log("every order with a carrier already has an offer — nothing to do");
    process.exit(0);
}

const byStatus = new Map();
for (const row of plan) {
    const bucket = `${row.offer_status} (order ${row.order_status})`;
    byStatus.set(bucket, (byStatus.get(bucket) ?? 0) + 1);
}

const defaultedTotals = plan.filter((row) => row.total_defaulted).length;

console.log(`${plan.length} offer(s) to create`);
console.table(
    [...byStatus.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([offer, orders]) => ({ offer, orders })),
);
// A carrier leg without a price is a hole in the logbook, not a free trip:
// the offer stores 0 and this line is what says how many to go and fix
console.log(`carrier price missing (offer total written as 0): ${defaultedTotals}`);

console.log("sample — the first 10 rows as they will be written:");
console.table(
    plan.slice(0, 10).map((row) => ({
        order_id: row.human_order_id,
        order_status: row.order_status,
        offer_status: row.offer_status,
        carrier: row.carrier_name,
        total: row.total,
        currency: row.currency,
        regime: row.fiscal_regime,
        since: row.carrier_since,
        trips: row.carrier_trips,
    })),
);

if (!ASSUME_YES) {
    console.log("\nnothing written. Re-run with --yes to insert these offers.");
    process.exit(0);
}

// Insert straight from the same CTE: one round trip, and the snapshots are
// recomputed by the database rather than shipped back through the client
const inserted = await sql.query(`${PLANNED}
insert into order_offer (
    id, order_id, carrier_id, carrier_name, fiscal_regime,
    subtotal, vat, total, currency,
    commission_subtotal, commission_vat, commission_total,
    client_subtotal, client_vat, client_total,
    includes_git, includes_gps, notes,
    status, carrier_since, carrier_trips, decided_at, created_by
)
select gen_random_uuid()::text, p.order_uuid, p.carrier_id, p.carrier_name, p.fiscal_regime,
       p.subtotal, p.vat, p.total, p.currency,
       p.commission_subtotal, p.commission_vat, p.commission_total,
       p.client_subtotal, p.client_vat, p.client_total,
       false, false, null,
       p.offer_status, p.carrier_since, p.carrier_trips,
       case when p.offer_status in ('accepted', 'lost') then p.decided_at end,
       null
from planned p
returning id`);

console.log(`\ninserted ${inserted.length} order_offer row(s)`);

const summary = await sql`
    select status, count(*)::int as offers
    from order_offer
    group by status
    order by status`;

console.table(summary);
