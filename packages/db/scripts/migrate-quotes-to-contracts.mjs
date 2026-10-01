/**
 * Carries the standing quotes over as contracts.
 *
 * A standing quote — a transporter's price for a client on a lane, valid
 * until a date — is an open-ended contract: that lane, that period, a price
 * per trip, no committed quantity. So each `quote` row becomes a `contract`
 * owned by the transporter, naming the client, with the quote's total as a
 * per-trip sell price and the quote's validity as the period; an accepted
 * quote is an active contract, one still standing is a draft (a proposal the
 * client can accept), and a declined, withdrawn or lapsed one is closed.
 *
 * Idempotent: `contract.legacy_quote_id` remembers the quote, so a second
 * run only picks up quotes that have no contract yet. The old /quotes?id=
 * addresses redirect through the same column. References are minted on
 * each transporter's own ORD counter, like a multi-trip order filed by hand.
 *
 * Usage:
 *   node packages/db/scripts/migrate-quotes-to-contracts.mjs          dry run
 *   node packages/db/scripts/migrate-quotes-to-contracts.mjs --yes    write
 * (reads DATABASE_URL from packages/db/.env or the environment — the OWNER url)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connect } from "./sql.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const yes = process.argv.includes("--yes");

function databaseUrl() {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
    const env = fs.readFileSync(path.join(root, "packages/db/.env"), "utf8");
    const match = env.match(/^DATABASE_URL=(.+)$/m);
    if (!match) throw new Error("DATABASE_URL not found in packages/db/.env or the environment");
    return match[1].trim();
}

const day = (date) => new Date(date).toISOString().slice(0, 10);

/** Maputo calendar year of a date, two digits, the way refs.ts formats it. */
const yearOf = (date) => Number(new Intl.DateTimeFormat("en", { timeZone: "Africa/Maputo", year: "numeric" }).format(new Date(date)));

async function main() {
    const sql = connect(databaseUrl());
    const [{ current_database: database }] = await sql`select current_database()`;
    console.log(`${yes ? "writing to" : "dry run against"} ${database}`);

    const quotes = await sql`
        select q.* from quote q
         where not exists (select 1 from contract c where c.legacy_quote_id = q.id)
         order by q.created_at`;
    console.log(`${quotes.length} quotes without a contract`);

    let written = 0;
    for (const q of quotes) {
        const status = q.status === "accepted" ? "active" : q.status === "sent" ? "draft" : "closed";
        const startsOn = day(q.loading_date ?? q.created_at);
        // A quote with no end date stands a year; one that ended before it began stands the day
        const endsOn = q.valid_until ? day(q.valid_until) : day(new Date(new Date(q.created_at).getTime() + 365 * 86_400_000));
        const period = endsOn < startsOn ? [endsOn, endsOn] : [startsOn, endsOn];
        const cover = [q.includes_git ? "GIT" : null, q.includes_gps ? "GPS" : null].filter(Boolean).join(" + ");
        const notes = [q.notes, cover ? `Inclui: ${cover}` : null, q.capacity_weight ? `Capacidade: ${Number(q.capacity_weight)} ${q.capacity_unit ?? ""}`.trim() : null]
            .filter(Boolean).join("\n") || null;
        const year = yearOf(q.created_at);

        console.log(`  ${q.id.slice(0, 8)}  ${q.status} → ${status}  ${period[0]}..${period[1]}  ${q.total} ${q.currency}/trip`);
        if (!yes) continue;

        await sql.query("begin");
        try {
            const [{ last }] = await sql`
                insert into organization_counter (organization_id, kind, year, last)
                values (${q.carrier_org_id}, 'ORD', ${year}, 1)
                on conflict (organization_id, kind, year) do update set last = organization_counter.last + 1
                returning last`;
            const reference = `ORD-${String(last).padStart(4, "0")}-${String(year % 100).padStart(2, "0")}`;

            await sql`
                insert into contract (
                    organization_id, reference, status, basis, client_org_id, origin, destination,
                    starts_on, ends_on, committed_qty, currency, fiscal_regime, sell_price, notes,
                    legacy_quote_id, created_by, created_at, updated_at
                ) values (
                    ${q.carrier_org_id}, ${reference}, ${status}, 'trips', ${q.client_org_id}, ${q.origin}, ${q.destination},
                    ${period[0]}, ${period[1]}, null, ${q.currency}, ${q.fiscal_regime},
                    ${{ model: "per-trip", rate: Number(q.total) }}, ${notes},
                    ${q.id}, ${q.created_by}, ${q.created_at}, ${q.updated_at}
                )`;
            // The transporter's own fleet moves it: one open share
            await sql`
                insert into contract_allocation (contract_id, share_qty)
                select id, null from contract where legacy_quote_id = ${q.id}`;
            await sql.query("commit");
            written += 1;
        } catch (error) {
            await sql.query("rollback");
            throw error;
        }
    }

    console.log(yes ? `${written} contracts written` : "dry run — nothing was written; re-run with --yes");
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
