/**
 * Backfills "order_location" from the WhatsApp locations already sitting in
 * chat history, so an order that has been tracked for weeks shows its whole
 * trail on the map the day the feature ships.
 *
 * The webhook flattens a shared location into a "📍 place — <maps url>"
 * inbound chat message (see apps/admin/src/lib/chats/infobip.ts). This reads
 * those bodies back: latitude/longitude come out of the maps URL, the place
 * name is what is left once the URL, a leading pin emoji and the trailing
 * " — " separator are stripped — the same rules as parseLocation() in
 * apps/admin/src/frontend/pages/chats/lib/thread-rows.ts.
 *
 * Only the webhook's own shape counts as a position: the body has to start
 * with the pin emoji AND the coordinates are read out of the maps URL itself.
 * A driver who types or forwards a maps link to the depot is not reporting
 * where his truck is, and a ping is permanent — the newest row is what the
 * map calls the truck's current position.
 *
 * A message is attributed to the newest order that already existed when it
 * arrived and either is the conversation's linked order (the human id, e.g.
 * "APPL021.26") or carries the same driver phone number (bare digits on both
 * sides, like normalizePhone); the conversation link only breaks the tie.
 * The time bound is what keeps a thread honest: chat_conversation is one row
 * per driver phone and its order_id is re-pointed on every new booking
 * (startConversation — "the newest booking wins the link"), so without it a
 * driver's whole history would pile onto whichever load he is running today.
 * Messages that resolve to no order are skipped and listed — a driver who
 * pinged before any order was created, or a thread whose order was removed.
 *
 * Safe to re-run: rows already backfilled are excluded from the plan and the
 * insert is `on conflict (chat_message_id) do nothing` besides.
 *
 * Usage:
 *   node packages/db/scripts/backfill-order-locations.mjs [--dry-run]
 *
 *   --dry-run  report the plan and write nothing.
 * (reads DATABASE_URL from apps/admin/.env or the environment)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const DRY_RUN = process.argv.includes("--dry-run");

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

// String.raw is load-bearing: in a plain template literal JS would eat the
// backslashes ("\d" cooks to "d") and every regex below would silently stop
// matching. Kept as one CTE so the plan and the insert see the same rows.
const RESOLVED = String.raw`
with located as (
    select m.id           as message_id,
           m.body         as body,
           m.created_at   as recorded_at,
           c.id           as conversation_id,
           c.order_id     as conversation_order_id,
           c.driver_phone as driver_phone,
           regexp_match(m.body, 'maps\.google\.com/\?q=(-?[0-9.]+),(-?[0-9.]+)') as coords
    from chat_message m
    join chat_conversation c on c.id = m.conversation_id
    where m.direction = 'inbound'
      -- the webhook's own shape, both halves of it: a pasted or typed maps
      -- link is not a position report
      and m.body like '📍%'
      and m.body like '%maps.google.com/?q=%'
),
parsed as (
    select message_id,
           body,
           recorded_at,
           conversation_id,
           conversation_order_id,
           driver_phone,
           (coords[1])::double precision as latitude,
           (coords[2])::double precision as longitude,
           -- mirrors parseLocation(): drop the maps URL, then a leading pin
           -- emoji, then the trailing " — ", then trim; empty label = null
           nullif(
               regexp_replace(
                   regexp_replace(
                       regexp_replace(
                           regexp_replace(body, 'https://maps\.google\.com/\?q=\S+', ''),
                       '^\s*📍\s*', ''),
                   '\s*—\s*$', ''),
               '^\s+|\s+$', '', 'g'),
               ''
           ) as place_name
    from located
    where coords is not null
),
resolved as (
    select p.message_id,
           p.body,
           p.recorded_at,
           p.conversation_id,
           p.conversation_order_id,
           p.driver_phone,
           p.latitude,
           p.longitude,
           p.place_name,
           matched.id       as order_uuid,
           matched.order_id as human_order_id
    from parsed p
    left join lateral (
        select o.id, o.order_id
        from "order" o
        -- Both rules are time-bounded and neither short-circuits the other:
        -- the thread's current link cannot claim a message that predates the
        -- order it now points at, and such a message still reaches the phone
        -- rule instead of being dropped.
        where o.created_at <= p.recorded_at
          and (
                  (p.conversation_order_id is not null and o.order_id = p.conversation_order_id)
                  or (p.driver_phone <> ''
                      and regexp_replace(coalesce(o.driver_phone_number, ''), '\D', '', 'g') = p.driver_phone)
              )
        order by (o.order_id = p.conversation_order_id) desc, o.created_at desc
        limit 1
    ) matched on true
    where not exists (
        select 1 from order_location ol where ol.chat_message_id = p.message_id
    )
)`;

const plan = await sql.query(`${RESOLVED}
select message_id, human_order_id, order_uuid, conversation_id, conversation_order_id,
       driver_phone, latitude, longitude, place_name, recorded_at, body
from resolved
order by recorded_at`);

if (plan.length === 0) {
    console.log("no un-backfilled WhatsApp locations found — nothing to do");
    process.exit(0);
}

const attributable = plan.filter((row) => row.order_uuid !== null);
const skipped = plan.filter((row) => row.order_uuid === null);

const counts = new Map();
for (const row of attributable) {
    counts.set(row.human_order_id, (counts.get(row.human_order_id) ?? 0) + 1);
}

console.log(`${plan.length} location message(s) to backfill: ${attributable.length} attributed, ${skipped.length} skipped`);
console.table(
    [...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([order_id, pings]) => ({ order_id, pings })),
);

// Counts alone hide a wrong attribution; the body is the only thing that
// shows what is about to become a truck position, so print it before the
// operator drops --dry-run
console.log("attributed — what each row will be written as:");
console.table(
    attributable.map((row) => ({
        order_id: row.human_order_id,
        recorded_at: row.recorded_at,
        latitude: row.latitude,
        longitude: row.longitude,
        place_name: row.place_name,
        body: String(row.body).slice(0, 60),
    })),
);

if (skipped.length > 0) {
    console.log("skipped — no order matched the conversation's order id or driver phone:");
    console.table(
        skipped.map((row) => ({
            message_id: row.message_id,
            conversation_order_id: row.conversation_order_id,
            driver_phone: row.driver_phone,
            recorded_at: row.recorded_at,
            body: String(row.body).slice(0, 60),
        })),
    );
}

if (DRY_RUN) {
    console.log("--dry-run: nothing written");
    process.exit(0);
}

if (attributable.length === 0) {
    console.log("nothing attributable to insert");
    process.exit(0);
}

const inserted = await sql.query(`${RESOLVED}
insert into order_location (
    id, order_id, conversation_id, chat_message_id,
    latitude, longitude, place_name, source, recorded_at
)
select gen_random_uuid()::text, r.order_uuid, r.conversation_id, r.message_id,
       r.latitude, r.longitude, r.place_name, 'whatsapp', r.recorded_at
from resolved r
where r.order_uuid is not null
on conflict (chat_message_id) do nothing
returning id`);

console.log(`inserted ${inserted.length} order_location row(s)`);
