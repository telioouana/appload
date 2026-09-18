/**
 * Retires the "to-loading" order status.
 *
 * The dispatch edge is now booked → at-loading, and the TS vocabulary no
 * longer carries "to-loading" — the pg enum still does, because dropping a
 * value from an enum is not an additive migration. This moves the rows that
 * are still parked on the retired status onto the one that replaced it, and
 * leaves a trail row per order saying what it used to be.
 *
 * `order_history` is NOT rewritten: the trail is what happened, and the app
 * maps the retired value at read time (LEGACY_ORDER_STATUS_ALIAS).
 *
 * With --backfill-dispatch it also writes one `order_dispatch` pack for every
 * on-going order that already has a rig and no open pack, so the loading
 * check and the papers view are not empty for the orders that were already
 * running the day the feature shipped. The packs carry `dispatched_by null`
 * — nobody dispatched them through the new door — and their documents are
 * whatever is currently on file for the subjects (the current, non-deleted,
 * non-superseded row per subject and type).
 *
 * Idempotent: an order already at at-loading is not in the plan, and an
 * order that already has an open pack is not backfilled.
 *
 * Usage:
 *   node packages/db/scripts/retire-to-loading.mjs [--yes] [--backfill-dispatch]
 *
 *   (no flag)             dry run — report the counts and write nothing
 *   --yes                 write
 *   --backfill-dispatch   also write the dispatch packs described above
 * (reads DATABASE_URL from apps/admin/.env or the environment)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const ASSUME_YES = process.argv.includes("--yes");
const BACKFILL = process.argv.includes("--backfill-dispatch");

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

const url = databaseUrl();
const sql = neon(url);
const q = (statement, params = []) => sql.query(statement, params);

const databaseName = decodeURIComponent(new URL(url).pathname.slice(1)).split("?")[0];

console.log(`database: ${databaseName}`);
console.log(ASSUME_YES ? "mode:     WRITE" : "mode:     DRY RUN — nothing is written");
console.log(`backfill: ${BACKFILL ? "yes — dispatch packs for on-going orders" : "no"}\n`);

/**
 * The statuses a truck is actually committed on: ON_GOING_STATUSES in
 * packages/domain/src/orders/status-groups.ts — a pack is only of use while
 * the trip is still running. Spelled out here because a plain node script
 * cannot import the workspace TypeScript; keep the two in step.
 * Deliberately NOT ACTIVE_STATUSES, which also carries "booked": a booked
 * order was never dispatched, so it has nothing to snapshot.
 */
const ON_GOING = [
    "at-loading", "loading", "waiting-documents", "on-route",
    "stopped", "issue", "at-border", "at-offloading", "offloading",
];

/**
 * Plan
 */
const stranded = await q(`
    select id, order_id, status
    from "order"
    where status = 'to-loading'
    order by order_id
`);

// `status` is the order_status_enum column, so the array parameter is
// compared against its text rendering — postgres has no enum = text operator
const ON_GOING_PREDICATE = `(o.status::text = any($1::text[]) or o.status = 'to-loading')`;

// The rig a pack is worth snapshotting: the same bar the dispatch door
// itself uses (isReadyToDispatch in packages/domain/src/orders/
// dispatch-readiness.ts), minus truck_age, which no check item reads. A
// plate with no driver would give the driver-identity item nothing to
// compare the arriving driver against.
const HAS_RIG = `o.truck_plate is not null
          and o.driver_id is not null
          and o.driver_name is not null
          and o.driver_phone_number is not null`;

const NO_OPEN_PACK = `not exists (
              select 1 from order_dispatch d
              where d.order_id = o.id and d.superseded_at is null
          )`;

const backfillable = BACKFILL
    ? await q(`
        select o.id, o.order_id, o.status, o.driver_id, o.driver_name,
               o.driver_phone_number, o.driver_passport,
               o.truck_plate, o.trailer_plate, o.link_plate
        from "order" o
        where ${ON_GOING_PREDICATE}
          and ${HAS_RIG}
          and ${NO_OPEN_PACK}
        order by o.order_id
    `, [ON_GOING])
    : [];

// The other side of the same set: on-going orders that get no pack because
// the rig on the row is incomplete. They are not an error — they are what
// Claire has to look at, since their loading check will have nothing behind it.
const incompleteRig = BACKFILL
    ? await q(`
        select o.order_id, o.status, o.truck_plate, o.driver_name, o.driver_phone_number
        from "order" o
        where ${ON_GOING_PREDICATE}
          and not (${HAS_RIG})
          and ${NO_OPEN_PACK}
        order by o.order_id
    `, [ON_GOING])
    : [];

console.log(`orders on "to-loading":            ${stranded.length}`);
if (BACKFILL) {
    console.log(`on-going orders without a pack:    ${backfillable.length}`);
    console.log(`skipped — incomplete rig:          ${incompleteRig.length}`);

    if (incompleteRig.length > 0) {
        console.log("\nsample — the first 10 on-going orders that will have no pack:");
        console.table(incompleteRig.slice(0, 10));
    }
}

if (stranded.length > 0) {
    console.log("\nsample — the first 10 orders to move:");
    console.table(stranded.slice(0, 10).map((row) => ({ order_id: row.order_id, from: row.status, to: "at-loading" })));
}

if (stranded.length === 0 && backfillable.length === 0) {
    console.log("\nnothing to do");
    process.exit(0);
}

if (!ASSUME_YES) {
    console.log("\nnothing written. Re-run with --yes to apply.");
    process.exit(0);
}

/**
 * Move. The status change bumps `version` so any reader holding the old one
 * loses the optimistic-lock handshake rather than writing over this.
 */
if (stranded.length > 0) {
    const moved = await q(`
        update "order"
        set status = 'at-loading', version = version + 1, updated_at = now()
        where status = 'to-loading'
        returning id
    `);

    await q(`
        insert into order_history (id, order_id, actor_user_id, kind, metadata, created_at)
        select gen_random_uuid()::text, id, null, 'system',
               jsonb_build_object('retiredStatus', 'to-loading'), now()
        from unnest($1::text[]) as moved(id)
    `, [moved.map((row) => row.id)]);

    console.log(`\nmoved ${moved.length} order(s) to at-loading`);
}

/**
 * Backfill. One pack per order, then its documents from whatever is current
 * for each subject. The vehicle ids are resolved from the plates, which is
 * what the order row carries.
 */
if (BACKFILL && backfillable.length > 0) {
    const packs = await q(`
        insert into order_dispatch (
            id, order_id, driver_id, driver_name, driver_phone_number, driver_passport,
            truck_id, trailer_id, link_id, truck_plate, trailer_plate, link_plate,
            dispatched_by, dispatched_at
        )
        select gen_random_uuid()::text, o.id, o.driver_id, o.driver_name,
               o.driver_phone_number, o.driver_passport,
               t.id, tr.id, l.id, o.truck_plate, o.trailer_plate, o.link_plate,
               null, coalesce(o.arrival_at_loading, o.deal_date, o.created_at)
        from "order" o
        left join truck t on t.reg_plate = o.truck_plate
        left join trailer tr on tr.reg_plate = o.trailer_plate
        left join link l on l.reg_plate = o.link_plate
        where o.id = any($1::text[])
        returning id, order_id
    `, [backfillable.map((row) => row.id)]);

    console.log(`wrote ${packs.length} dispatch pack(s)`);

    // The papers on file for each subject of each pack: the live row per
    // (subject, type) — not deleted, and not superseded by a later one. The
    // distinct on is what keeps the pack in step with currentDocuments
    // (packages/domain/src/kyc/subjects.ts): two rows of the same type can
    // both be unsuperseded when a re-upload never set supersedes_id, and the
    // newest one is the one the papers view shows.
    const documents = await q(`
        with subject as (
            select d.id as dispatch_id, 'driver' as subject_type, d.driver_id as subject_id
            from order_dispatch d where d.id = any($1::text[]) and d.driver_id is not null
            union all
            select d.id, 'truck', d.truck_id
            from order_dispatch d where d.id = any($1::text[]) and d.truck_id is not null
            union all
            select d.id, 'trailer', d.trailer_id
            from order_dispatch d where d.id = any($1::text[]) and d.trailer_id is not null
            union all
            select d.id, 'link', d.link_id
            from order_dispatch d where d.id = any($1::text[]) and d.link_id is not null
        )
        insert into order_dispatch_document (
            dispatch_id, subject_type, subject_id, kyc_document_id, type, status_at_snapshot, expires_at
        )
        select distinct on (s.dispatch_id, s.subject_type, s.subject_id, k.type)
               s.dispatch_id, s.subject_type, s.subject_id, k.id, k.type, k.status, k.expires_at
        from subject s
        join kyc_document k
          on k.subject_type = s.subject_type
         and k.subject_id = s.subject_id
         and k.deleted_at is null
         and not exists (
             select 1 from kyc_document newer
             where newer.supersedes_id = k.id and newer.deleted_at is null
         )
        order by s.dispatch_id, s.subject_type, s.subject_id, k.type, k.created_at desc
        on conflict (dispatch_id, kyc_document_id) do nothing
        returning dispatch_id
    `, [packs.map((row) => row.id)]);

    console.log(`wrote ${documents.length} snapshot document row(s)`);
}

const summary = await sql`
    select status, count(*)::int as orders
    from "order"
    group by status
    order by status`;

console.table(summary);
