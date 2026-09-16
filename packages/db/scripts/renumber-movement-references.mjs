/**
 * Gives every existing movement the reference its company will know it by.
 *
 * References used to be one global sequence ("TRP-41" / "ORD-41"); they are
 * now per company, per kind, per year — "ORD-0001-26". This walks each
 * organization's loads oldest first and hands out the numbers:
 *
 *   own-fleet                                          -> ORD ("reference")
 *   partner, committed (scheduled, booked, in progress,
 *                       delivered, closed)             -> ORD ("reference")
 *   any other partner load                             -> REQ ("request_reference")
 *
 * The year is the Maputo calendar year the row was created in, so a company
 * that filed its first load in 2025 and its next in 2026 gets ORD-0001-25
 * and ORD-0001-26. `seq` is untouched — it stays the insertion order.
 *
 * Then `organization_counter` is set to the highest number handed out per
 * (organization, kind, year), so the next reference minted by the app
 * continues the run instead of colliding with it.
 *
 * Finally the executor side of a subcontract has its `client_reference`
 * rewritten: a row that carries the old global "ORD-41" of the load it
 * executes is repointed at that parent's NEW reference — its REQ when the
 * parent never reached a committed status (a cancelled subcontract), which is
 * still the only name that parent has. Client references that are anything
 * else (a real PO number) are left alone.
 *
 * Run ONCE per database, before the portal deploy. Idempotent by default:
 * a row that already has the reference it needs is skipped.
 *
 * Usage:
 *   node packages/db/scripts/renumber-movement-references.mjs [--yes] [--force]
 *
 *   (no flag)   dry run — print the per-company plan and write nothing
 *   --yes       write
 *   --force     renumber rows that already have a reference (a full redo:
 *               every reference changes, so never on a live database)
 * (reads DATABASE_URL from apps/admin/.env or the environment)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const ASSUME_YES = process.argv.includes("--yes");
const FORCE = process.argv.includes("--force");

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
console.log(`force:    ${FORCE ? "yes — every row is renumbered" : "no — only rows with no reference yet"}\n`);

/**
 * The statuses a partner load is committed on: somebody is moving it, so it
 * is an order and not a request any more. MOVEMENT_STATUS in
 * packages/db/src/schemas/movements.ts — spelled out here because a plain
 * node script cannot import the workspace TypeScript; keep the two in step.
 */
const COMMITTED = new Set([
    "scheduled", "booked",
    "at-loading", "loading", "waiting-documents", "on-route",
    "stopped", "issue", "at-border", "at-offloading", "offloading",
    "delivered", "closed",
]);

/** "ORD-0001-26" — 4-digit counter, 2-digit year. */
const format = (kind, n, year) => `${kind}-${String(n).padStart(4, "0")}-${String(year % 100).padStart(2, "0")}`;

/** One spelling of the (organization, kind, year) counter key, read and written. */
const counterKey = (organizationId, kind, year) => `${organizationId} ${kind} ${year}`;

/**
 * Plan. The Maputo year comes from the database rather than from JS: the
 * timestamps are naive UTC, and postgres owns that conversion everywhere else.
 */
const rows = await q(`
    SELECT m."id",
           m."organization_id",
           m."execution",
           m."status",
           m."reference",
           m."request_reference",
           extract(year from (m."created_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Maputo'))::int AS ref_year,
           o."name" AS organization_name
    FROM "movement" m
    JOIN "organization" o ON o."id" = m."organization_id"
    ORDER BY m."organization_id", m."created_at", m."seq"
`);

// (organization, kind, year) -> last number handed out
const counters = new Map();

/**
 * Numbers already in the books — from an earlier run, or minted by the app.
 * A row that keeps its reference keeps its number, so the run has to carry on
 * past it rather than hand the same one out twice.
 */
if (!FORCE) {
    for (const row of rows) {
        for (const reference of [row.reference, row.request_reference]) {
            const parsed = /^(REQ|ORD)-(\d{4})-(\d{2})$/.exec(reference ?? "");

            if (!parsed) continue;

            const key = counterKey(row.organization_id, parsed[1], 2000 + Number(parsed[3]));
            counters.set(key, Math.max(counters.get(key) ?? 0, Number(parsed[2])));
        }
    }
}
// organization -> { name, ord, req, skipped }
const perCompany = new Map();
const updates = [];

for (const row of rows) {
    const kind = row.execution === "own-fleet" || COMMITTED.has(row.status) ? "ORD" : "REQ";
    const column = kind === "ORD" ? "reference" : "request_reference";
    const current = kind === "ORD" ? row.reference : row.request_reference;

    const company = perCompany.get(row.organization_id) ?? { name: row.organization_name, ORD: 0, REQ: 0, skipped: 0 };
    perCompany.set(row.organization_id, company);

    if (current !== null && !FORCE) {
        company.skipped += 1;
        continue;
    }

    const key = counterKey(row.organization_id, kind, row.ref_year);
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);

    company[kind] += 1;
    updates.push({ id: row.id, column, value: format(kind, next, row.ref_year) });
}

console.log(`--- plan (${rows.length} movements, ${perCompany.size} companies) ---`);
console.table(
    [...perCompany.entries()].map(([id, company]) => ({
        organization: company.name,
        id,
        ORD: company.ORD,
        REQ: company.REQ,
        "already numbered": company.skipped,
    })),
);

/**
 * The executor rows whose `client_reference` is an old global "ORD-41": the
 * parent that names them in `execution_movement_id` is what they should
 * carry instead.
 */
const clientRefs = await q(`
    SELECT child."id", child."client_reference" AS old_reference, coalesce(parent."reference", parent."request_reference") AS parent_reference
    FROM "movement" child
    JOIN "movement" parent ON parent."execution_movement_id" = child."id"
    WHERE child."client_reference" ~ '^ORD-[0-9]+$'
`);

console.log(`\n--- executor client references to repoint: ${clientRefs.length} ---`);

if (!ASSUME_YES) {
    console.log(`\n${updates.length} references would be written. Re-run with --yes to write.`);
    process.exit(0);
}

/**
 * A full redo hands every number out again, and the batched UPDATE below is
 * checked against `movement_reference_uidx` row by row inside one statement:
 * a stale number still sitting on a row this run now calls a REQ (an
 * un-booked load keeps its old ORD in `reference`) would collide with the row
 * the shifted numbering hands it to. Empty the set first, counters included —
 * they are rebuilt from the rows at the end.
 */
if (FORCE) {
    console.log("\nclearing every existing reference (--force)...");
    await sql`update "movement" set "reference" = null, "request_reference" = null`;
    await sql`delete from "organization_counter"`;
}

/**
 * Write. Batched multi-row statements — one round trip each over the HTTP
 * driver, so a row at a time would take minutes.
 */
async function writeReferences(column, entries, batchSize = 200) {
    let written = 0;

    for (let start = 0; start < entries.length; start += batchSize) {
        const batch = entries.slice(start, start + batchSize);
        const params = [];
        const tuples = batch.map((entry) => {
            params.push(entry.id, entry.value);
            return `($${params.length - 1}, $${params.length})`;
        });

        await q(
            `UPDATE "movement" AS m SET "${column}" = v.value
             FROM (VALUES ${tuples.join(", ")}) AS v(id, value)
             WHERE m."id" = v.id`,
            params,
        );
        written += batch.length;
    }

    return written;
}

console.log("\nwriting references...");
const ord = await writeReferences("reference", updates.filter((update) => update.column === "reference"));
const req = await writeReferences("request_reference", updates.filter((update) => update.column === "request_reference"));
console.log(`  reference          ${ord}`);
console.log(`  request_reference  ${req}`);

/**
 * Counters. Read back from the rows rather than from the run, so references
 * written by an earlier run (or by the app) are counted too.
 */
console.log("\nsetting organization_counter...");
const [{ counted }] = await sql`
    with parsed as (
        select "organization_id",
               substring(ref from 1 for 3) as kind,
               substring(ref from 5 for 4)::int as n,
               substring(ref from 10 for 2)::int as yy
        from (
            select "organization_id", "reference" as ref from "movement" where "reference" ~ '^(REQ|ORD)-[0-9]{4}-[0-9]{2}$'
            union all
            select "organization_id", "request_reference" as ref from "movement" where "request_reference" ~ '^(REQ|ORD)-[0-9]{4}-[0-9]{2}$'
        ) refs
    ),
    highest as (
        select "organization_id", kind, 2000 + yy as year, max(n) as last
        from parsed
        group by 1, 2, 3
    ),
    written as (
        insert into "organization_counter" ("organization_id", "kind", "year", "last")
        select "organization_id", kind, year, last from highest
        on conflict ("organization_id", "kind", "year")
        do update set "last" = greatest("organization_counter"."last", excluded."last")
        returning 1
    )
    select count(*)::int as counted from written`;
console.log(`  ${counted} counter rows`);

console.log("\nrepointing executor client references...");
const [{ repointed }] = await sql`
    with repoint as (
        update "movement" child
        set "client_reference" = coalesce(parent."reference", parent."request_reference")
        from "movement" parent
        where parent."execution_movement_id" = child."id"
          and child."client_reference" ~ '^ORD-[0-9]+$'
          and coalesce(parent."reference", parent."request_reference") is not null
        returning 1
    )
    select count(*)::int as repointed from repoint`;
console.log(`  ${repointed} rows`);

const summary = await sql`
    select count(*)::int as movements,
           count("reference")::int as with_reference,
           count("request_reference")::int as with_request_reference
    from "movement"`;

console.log("\ndone:");
console.table(summary);
