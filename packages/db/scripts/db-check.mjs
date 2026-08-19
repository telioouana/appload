import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const [orders] = await sql`SELECT count(*)::int AS n FROM "order"`;
const [orgs] = await sql`SELECT count(*)::int AS n FROM organization`;
const sample = await sql`
    SELECT order_id, shipper_name, loading_address, offloading_address,
           carrier_invoice_number, carrier_payment_status, arrival_ontime_loading
    FROM "order" ORDER BY legacy_id LIMIT 3`;
const geo = await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE loading_address->>'placeId' <> '') ::int AS loading_with_place,
           count(*) FILTER (WHERE offloading_address->>'placeId' <> '') ::int AS offloading_with_place,
           count(*) FILTER (WHERE carrier_invoice_number IS NOT NULL)::int AS with_carrier_invoice,
           count(*) FILTER (WHERE arrival_ontime_loading IS NOT NULL)::int AS with_ontime_loading
    FROM "order"`;
const orgSample = await sql`SELECT id, name, type, email, nuit FROM organization ORDER BY created_at LIMIT 5`;

console.log(JSON.stringify({ orders, orgs, geo, sample, orgSample }, null, 2));
