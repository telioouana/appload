/**
 * Fills "fx_daily_rate" — one USD→MZN / USD→ZAR quote per calendar day.
 *
 * The KPIs page converts every trip's money to USD at the rate of its loading
 * day, so a report mixing MZN, ZAR and USD legs adds up. That only works if
 * the table covers the whole history: a day it lacks makes the report borrow
 * the nearest earlier rate and flag those transports as provisional. The app
 * tops up recent days by itself (apps/admin/src/lib/kpis/fx.ts); this script
 * is what loads the years behind them, once per environment.
 *
 * Calendar days, not trading days: cargo loads at weekends too. Two sources,
 * because neither covers the whole span:
 *  - 2024-03-02 onward: the keyless daily feed @fawazahmed0/currency-api,
 *    which publishes a file per calendar day (jsDelivr, then its pages.dev
 *    mirror). Its history begins on 2024-03-02; every earlier day 404s.
 *  - before that: Yahoo Finance daily closes for USDMZN=X and USDZAR=X — one
 *    request per symbol for the whole span. Yahoo skips weekends and
 *    holidays, so those days are carried forward from the previous close and
 *    written as `source: "carry"` with the close's own day in `quoted_on`.
 *
 * The same carry closes the odd hole either source leaves — the feed never
 * published 2025-12-10, for instance. A day with no rate at all would make
 * the report borrow across it and call those transports provisional, which
 * would be wrong: the rate is known, only the file is missing.
 *
 * Nothing is ever overwritten (`on conflict (day) do nothing`), so a re-run
 * only fills gaps and a hand-corrected row survives it.
 *
 * Usage:
 *   node packages/db/scripts/seed-daily-rates.mjs [--from YYYY-MM-DD] [--dry] [--yes]
 *
 *   --dry    fetch and report only. The default, and it wins over --yes.
 *   --yes    insert the missing days.
 *   --from   first day to cover. Default: the earliest expected_loading_date
 *            in "order" (2022-01-01 when there are no orders yet). The range
 *            always ends on today in Maputo — no source quotes the future.
 * (reads DATABASE_URL from apps/admin/.env or the environment)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// ---------------------------------------------------------------------------
// Arguments

const argValue = (name, fallback) => {
    const at = process.argv.indexOf(`--${name}`);
    const next = process.argv[at + 1];
    return at >= 0 && next && !next.startsWith("--") ? next : fallback;
};
const DRY = !process.argv.includes("--yes") || process.argv.includes("--dry");

// The daily feed's first published file is 2024-03-02; everything earlier
// comes from Yahoo. Keep the two constants together — they are one boundary.
const FEED_FIRST_DAY = "2024-03-02";
const FEED_CONCURRENCY = 6;
const FEED_TIMEOUT_MS = 15_000;

// Days of Yahoo history to pull in front of the range, so the first day can be
// carried from a close even when the range opens on a Sunday
const YAHOO_LEAD_DAYS = 14;

// Rows per insert statement: a few hundred keeps every run to a handful of
// round trips without going near the parameter limit
const BATCH = 300;

// Yahoo answers 429/403 to an unadorned fetch
const BROWSER_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Days

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" -> the same string, validated; throws on anything else. */
const parseDay = (value, label) => {
    const day = String(value ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
        throw new Error(`${label} must be YYYY-MM-DD, got "${value}"`);
    }
    return day;
};

const addDays = (day, count) => new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10);

const daysBetween = (from, to) => {
    const out = [];
    for (let day = from; day <= to; day = addDays(day, 1)) out.push(day);
    return out;
};

/**
 * Today in Maputo. The app resolves periods on Maputo's calendar, so a run in
 * the two hours after UTC midnight must not stop the range a day short.
 */
const maputoToday = () =>
    new Intl.DateTimeFormat("en-CA", {
        timeZone: "Africa/Maputo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());

const isPositive = (value) => Number.isFinite(value) && value > 0;

// Yahoo hands back float32 noise (63.20000076293945) and the feed eight
// decimals. Four is what a day's rate is worth to a report in dollars.
const round4 = (value) => Math.round(value * 10_000) / 10_000;

// ---------------------------------------------------------------------------
// Rate sources

/** The feed's quote for one calendar day, or null when neither host answers. */
async function fetchFeedRate(day) {
    const urls = [
        `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${day}/v1/currencies/usd.min.json`,
        `https://${day}.currency-api.pages.dev/v1/currencies/usd.min.json`,
    ];
    for (const url of urls) {
        let data;
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
            if (!response.ok) continue;
            data = await response.json();
        } catch {
            continue;
        }
        const usdMzn = Number(data?.usd?.mzn);
        const usdZar = Number(data?.usd?.zar);
        if (!isPositive(usdMzn) || !isPositive(usdZar)) continue;
        // The feed answers a day it lacks with the nearest one it has and says
        // so in `date` — that is what quoted_on records
        const quotedOn = typeof data.date === "string" ? data.date : day;
        return { day, usdMzn: round4(usdMzn), usdZar: round4(usdZar), source: "feed", quotedOn };
    }
    return null;
}

/** Daily closes for one Yahoo symbol as [{ day, close }], ascending, gaps dropped. */
async function fetchYahooCloses(symbol, fromDay, toDay) {
    // A week past the end: the last bar of the window still has to land inside it
    const period1 = Math.floor(Date.parse(`${fromDay}T00:00:00Z`) / 1000) - 86_400;
    const period2 = Math.floor(Date.parse(`${toDay}T00:00:00Z`) / 1000) + 7 * 86_400;

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d`;
    const response = await fetch(url, {
        headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Yahoo ${symbol} ${response.status}: ${(await response.text()).slice(0, 200)}`);

    const result = (await response.json())?.chart?.result?.[0];
    const stamps = result?.timestamp ?? [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];

    // Yahoo stamps a daily FX bar at midnight in the exchange's own timezone,
    // which for the =X pairs is Europe/London — so from late March to late
    // October the bar of a day is labelled 23:00 UTC of the day before.
    // Reading that instant in UTC would file every summer close one day early.
    const tz = result?.meta?.exchangeTimezoneName ?? "Europe/London";
    const tradingDay = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });

    const out = [];
    for (let at = 0; at < stamps.length; at++) {
        const close = Number(closes[at]);
        if (isPositive(close)) out.push({ day: tradingDay.format(new Date(stamps[at] * 1000)), close });
    }
    return out.sort((a, b) => a.day.localeCompare(b.day));
}

/** The close of `day`, or the last one before it — the carry rule, in one place. */
const closeOnOrBefore = (closes, day) => {
    let found = null;
    for (const entry of closes) {
        if (entry.day > day) break;
        found = entry;
    }
    return found;
};

/** Runs `worker` over `items` with at most `limit` in flight, results in order. */
async function mapPool(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        for (let at = next++; at < items.length; at = next++) {
            results[at] = await worker(items[at], at);
        }
    });
    await Promise.all(runners);
    return results;
}

// ---------------------------------------------------------------------------
// Database

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

const [{ exists }] = await sql`select to_regclass('fx_daily_rate') is not null as exists`;
if (!exists) {
    throw new Error("fx_daily_rate not found — run create-fx-daily-rate-table.mjs (dev) or db:migrate (production) first");
}

// ---------------------------------------------------------------------------
// Range

const TODAY = maputoToday();

const [firstLoading] = await sql`select min(expected_loading_date)::date::text as day from "order"`;
const from = parseDay(argValue("from", firstLoading?.day ?? "2022-01-01"), "--from");
const to = TODAY;

if (from > to) throw new Error(`--from ${from} is after today in Maputo (${to})`);

const days = daysBetween(from, to);

// The rates already in the table, plus the last one in front of the range:
// both are what a gap inside the range can be carried from on a re-run
const stored = await sql.query(
    `select day::text as day, usd_mzn, usd_zar, quoted_on::text as quoted_on
     from fx_daily_rate
     where day between $1 and $2
     union all
     (select day::text, usd_mzn, usd_zar, quoted_on::text from fx_daily_rate where day < $1 order by day desc limit 1)`,
    [from, to],
);

const known = new Map();
for (const row of stored) {
    known.set(row.day, { usdMzn: Number(row.usd_mzn), usdZar: Number(row.usd_zar), quotedOn: row.quoted_on });
}

const have = new Set(days.filter((day) => known.has(day)));
const missing = days.filter((day) => !have.has(day));

console.log(DRY ? "mode:    DRY RUN — nothing is written" : "mode:    WRITE");
console.log(`range:   ${from} → ${to} (${days.length} days), ${have.size} already stored, ${missing.length} to fetch`);
if (!argValue("from", null)) {
    console.log(`         (--from defaults to the earliest expected_loading_date: ${firstLoading?.day ?? "no orders, using 2022-01-01"})`);
}

if (!missing.length) {
    console.log("\nnothing to do — every day in the range already has a rate.");
    process.exit(0);
}

// ---------------------------------------------------------------------------
// Fetch

const fetched = [];
const failed = [];

const yahooDays = missing.filter((day) => day < FEED_FIRST_DAY);
const feedDays = missing.filter((day) => day >= FEED_FIRST_DAY);

if (yahooDays.length) {
    console.log(`\nYahoo Finance: ${yahooDays.length} day(s), ${yahooDays[0]} → ${yahooDays.at(-1)}...`);
    const lead = addDays(yahooDays[0], -YAHOO_LEAD_DAYS);

    let mznCloses = [];
    let zarCloses = [];
    try {
        [mznCloses, zarCloses] = await Promise.all([
            fetchYahooCloses("USDMZN=X", lead, yahooDays.at(-1)),
            fetchYahooCloses("USDZAR=X", lead, yahooDays.at(-1)),
        ]);
    } catch (error) {
        console.warn(`  ${error.message}`);
    }

    for (const day of yahooDays) {
        const mzn = closeOnOrBefore(mznCloses, day);
        const zar = closeOnOrBefore(zarCloses, day);
        // Nothing on or before it — the carry pass below is its last chance
        if (!mzn || !zar) continue;
        // A row is only as fresh as its oldest half, so the older of the two
        // closes dates it — and any borrowing at all makes it a carry
        const quotedOn = mzn.day < zar.day ? mzn.day : zar.day;
        const source = mzn.day === day && zar.day === day ? "yahoo" : "carry";
        fetched.push({ day, usdMzn: round4(mzn.close), usdZar: round4(zar.close), source, quotedOn });
    }
}

if (feedDays.length) {
    console.log(`\ncurrency feed: ${feedDays.length} day(s), ${feedDays[0]} → ${feedDays.at(-1)}...`);
    let done = 0;
    const rates = await mapPool(feedDays, FEED_CONCURRENCY, async (day) => {
        const rate = await fetchFeedRate(day);
        done += 1;
        if (done % 100 === 0) console.log(`  ${done}/${feedDays.length}`);
        return rate;
    });
    // A day neither host answered goes to the carry pass, like a weekend
    for (const rate of rates) if (rate) fetched.push(rate);
}

// ---------------------------------------------------------------------------
// Carry — whatever both sources left open takes the previous day's rate, so
// the table has no holes for the report to borrow across

for (const row of fetched) {
    known.set(row.day, { usdMzn: row.usdMzn, usdZar: row.usdZar, quotedOn: row.quotedOn });
}

const before = [...known.keys()].filter((day) => day < from).sort().at(-1);
let last = before ? { ...known.get(before) } : null;

for (const day of days) {
    const rate = known.get(day);

    if (rate) {
        last = { ...rate };
        continue;
    }

    if (!last) {
        failed.push(`${day}: no rate on or before it, from either source or the table`);
        continue;
    }

    // The carried row keeps the original quote's date, so a chain of carried
    // days all point at the close they came from rather than at each other
    fetched.push({ day, usdMzn: last.usdMzn, usdZar: last.usdZar, source: "carry", quotedOn: last.quotedOn });
    known.set(day, { ...last });
}

fetched.sort((a, b) => a.day.localeCompare(b.day));

// ---------------------------------------------------------------------------
// Report

const bySource = new Map();
for (const row of fetched) bySource.set(row.source, (bySource.get(row.source) ?? 0) + 1);

console.log(`\n${fetched.length} of ${missing.length} missing day(s) resolved`);
console.table([...bySource.entries()].sort().map(([source, rows]) => ({ source, rows })));

const sample = fetched.filter((_, at) => at === 0 || at === fetched.length - 1);
for (const row of sample) {
    console.log(`  ${row.day}  USD→MZN ${row.usdMzn.toFixed(4)}  USD→ZAR ${row.usdZar.toFixed(4)}  ${row.source} (quoted ${row.quotedOn})`);
}

if (failed.length) {
    console.log(`\n${failed.length} day(s) could not be filled:`);
    for (const line of failed) console.log(`  ${line}`);
}

if (DRY) {
    console.log(`\nDRY RUN — re-run with --yes to insert ${fetched.length} row(s). Existing days are never touched.`);
    process.exit(failed.length ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Write

let written = 0;

for (let at = 0; at < fetched.length; at += BATCH) {
    const chunk = fetched.slice(at, at + BATCH);
    const params = [];
    const values = chunk.map((row) => {
        const base = params.length;
        params.push(row.day, row.usdMzn, row.usdZar, row.source, row.quotedOn);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    });
    const inserted = await sql.query(
        `insert into fx_daily_rate (day, usd_mzn, usd_zar, source, quoted_on)
         values ${values.join(", ")}
         on conflict (day) do nothing
         returning day`,
        params,
    );
    written += inserted.length;
}

console.log(`\ninserted ${written} row(s)`);

const totals = await sql`
    select source, count(*)::int as days, min(day)::text as first, max(day)::text as last
    from fx_daily_rate
    group by source
    order by source`;
console.table(totals);

const [{ gaps }] = await sql.query(
    `select count(*)::int as gaps
     from generate_series($1::date, $2::date, interval '1 day') as d(day)
     where not exists (select 1 from fx_daily_rate r where r.day = d.day::date)`,
    [from, to],
);

const [summary] = await sql`
    select count(*)::int as days, min(day)::text as first, max(day)::text as last from fx_daily_rate`;

console.log(`\n${summary.days} day(s) stored, ${summary.first} → ${summary.last}`);

if (gaps) {
    console.log(`${gaps} day(s) of ${from} → ${to} are still missing — re-run to retry them.`);
    process.exit(1);
}

console.log(`every day from ${from} to ${to} has a rate.`);
