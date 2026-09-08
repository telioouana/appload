/**
 * Seeds the MONTHLY RATES tab of the logbook.
 *
 * The Metrics page converts each month's MZN and ZAR figures at the rate of
 * that month's first day, so a 2022 trip keeps its 2022 value however the
 * metical moves afterwards. Those rates live as static numbers in a MONTHLY
 * RATES tab beside Claire's data — never formulas, because GOOGLEFINANCE
 * re-evaluates on every open and would silently re-price the whole history
 * (exactly what the sheet's own "eq. USD" columns do today). Claire can
 * correct any month by editing its number and marking Source "manual"; the
 * app reads whatever the tab says.
 *
 * The app pins the current month by itself when it finds it missing. This
 * script backfills the years behind it, from two sources because neither
 * covers the whole span:
 *  - 2024-03 onward: the keyless daily feed @fawazahmed0/currency-api, the
 *    file dated the first of the month (jsDelivr, then its pages.dev mirror).
 *    The feed's history starts on 2024-03-02, so March 2024 is quoted on the
 *    2nd and its Note says so.
 *  - before that: Yahoo Finance daily closes for USDMZN=X and USDZAR=X — one
 *    request per symbol for the whole span — taking the close of the first
 *    trading day on or after the 1st.
 *
 * Nothing is ever overwritten. A month already in the tab is left exactly as
 * it is, so a re-run only fills gaps and a hand-corrected row survives it.
 *
 * Usage:
 *   node packages/db/scripts/seed-monthly-rates.mjs [--spreadsheet <id>] [--from YYYY-MM] [--to YYYY-MM] [--dry] [--yes]
 *
 *   --spreadsheet  the logbook to seed. Default: GOOGLE_SHEETS_ORDERS_SPREADSHEET_ID
 *            from apps/admin/.env (the dev logbook); pass the production
 *            logbook's id to seed that one.
 *   --dry    fetch and print the table only. The default, and it wins over
 *            --yes, so writing to Claire's spreadsheet is always deliberate.
 *   --yes    create the tab when missing and append the months that are new.
 *   --from   first month to consider (default 2022-01, the year trading began).
 *   --to     last month (default the current month in Maputo; a later month is
 *            capped, since no source quotes the future).
 */

import {
    loadEnv,
    googleAccessToken,
    sheetsGet,
    getValues,
    setValues,
    appendValues,
    batchUpdate,
} from "./google-sheets.mjs";

// ---------------------------------------------------------------------------
// Arguments

const argValue = (name, fallback) => {
    const at = process.argv.indexOf(`--${name}`);
    const next = process.argv[at + 1];
    return at >= 0 && next && !next.startsWith("--") ? next : fallback;
};
const DRY = !process.argv.includes("--yes") || process.argv.includes("--dry");

const RATES_TAB = "MONTHLY RATES";
const RATES_HEADER = ["Month", "USD→MZN", "USD→ZAR", "Source", "Pinned on", "Note"];

// The daily feed's first published file is 2024-03-02; everything earlier
// comes from Yahoo. Keep the two constants together — they are one boundary.
const FEED_FIRST_MONTH = "2024-03";
const FEED_LOOKAHEAD_DAYS = 3;

// Sanity band for a human skim, not a rejection rule: the metical has been
// pegged near 63.9 for years and the rand has run 14–19 over the period.
const SANE_MZN = [60, 70];
const SANE_ZAR = [13, 21];

// Yahoo answers 429/403 to an unadorned fetch
const BROWSER_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Months

const monthKey = (year, month) => `${year}-${String(month).padStart(2, "0")}`;

/** "YYYY-MM" -> { year, month } with month 1-12; throws on anything else. */
const parseMonth = (value, label) => {
    const match = /^(\d{4})-(\d{2})$/.exec(String(value ?? "").trim());
    const month = match ? Number(match[2]) : 0;
    if (!match || month < 1 || month > 12) throw new Error(`${label} must be YYYY-MM, got "${value}"`);
    return { year: Number(match[1]), month };
};

// Months as a single integer, so a range is a plain for loop
const monthIndex = ({ year, month }) => year * 12 + (month - 1);
const monthAt = (index) => ({ year: Math.floor(index / 12), month: (index % 12) + 1 });
const keyAt = (index) => monthKey(monthAt(index).year, monthAt(index).month);
const dayOne = (key) => `${key}-01`;

/**
 * The current month in Maputo. The app pins by Maputo's calendar, so a run in
 * the two hours after UTC midnight must not stop the range a month short.
 */
const currentMonthKey = () => {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Africa/Maputo",
        year: "numeric",
        month: "2-digit",
    }).formatToParts(new Date());
    const part = (type) => parts.find((entry) => entry.type === type).value;
    return `${part("year")}-${part("month")}`;
};

const isPositive = (value) => Number.isFinite(value) && value > 0;

// Yahoo hands back float32 noise (63.20000076293945) and the feed eight
// decimals. Four is what the page shows and all a monthly peg means.
const round4 = (value) => Math.round(value * 10_000) / 10_000;

// ---------------------------------------------------------------------------
// Rate sources

/**
 * The feed's quote for the first of a month. A day can be missing (and the
 * whole of 2024-03-01 is), so walk forward a little and report which file
 * actually answered — the caller writes that into Note.
 */
async function fetchFeedRate(key) {
    const first = Date.parse(`${dayOne(key)}T00:00:00Z`);
    for (let offset = 0; offset < FEED_LOOKAHEAD_DAYS; offset++) {
        const day = new Date(first + offset * 86_400_000).toISOString().slice(0, 10);
        const urls = [
            `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${day}/v1/currencies/usd.min.json`,
            `https://${day}.currency-api.pages.dev/v1/currencies/usd.min.json`,
        ];
        for (const url of urls) {
            let data;
            try {
                const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
                if (!response.ok) continue;
                data = await response.json();
            } catch {
                continue;
            }
            const usdMzn = Number(data?.usd?.mzn);
            const usdZar = Number(data?.usd?.zar);
            if (!isPositive(usdMzn) || !isPositive(usdZar)) continue;
            const quotedOn = typeof data.date === "string" ? data.date : day;
            return { key, usdMzn: round4(usdMzn), usdZar: round4(usdZar), source: "feed", quotedOn };
        }
    }
    return null;
}

/** Daily closes for one Yahoo symbol as [{ day, close }], ascending, gaps dropped. */
async function fetchYahooCloses(symbol, firstIndex, lastIndex) {
    const start = monthAt(firstIndex);
    const afterEnd = monthAt(lastIndex + 1);
    // A day before the range and a week past it: the bar of a summer 1st is
    // stamped at 23:00 UTC of the day before (see below), and a month whose
    // first trading day is late still has to land inside the window
    const period1 = Math.floor(Date.UTC(start.year, start.month - 1, 1) / 1000) - 86_400;
    const period2 = Math.floor(Date.UTC(afterEnd.year, afterEnd.month - 1, 8) / 1000);

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
    // October the bar of the 1st is labelled 23:00 UTC of the 31st. Reading
    // that instant in UTC skipped the 1st and pinned the next trading day in
    // nine of the twenty-six months before the feed takes over: April 2022
    // took the 4th (14.6502) instead of Friday the 1st (14.5954).
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

/** The first close inside the month — Yahoo skips weekends and holidays. */
const firstCloseIn = (closes, key) => {
    const from = dayOne(key);
    const until = dayOne(keyAt(monthIndex(parseMonth(key, "month")) + 1));
    return closes.find((entry) => entry.day >= from && entry.day < until) ?? null;
};

// ---------------------------------------------------------------------------
// Range — parsed before anything talks to Google, so a typo fails instantly

const CURRENT = currentMonthKey();
const from = parseMonth(argValue("from", "2022-01"), "--from");
const requested = parseMonth(argValue("to", CURRENT), "--to");
const current = parseMonth(CURRENT, "the current month");

const capped = monthIndex(requested) > monthIndex(current);
const to = capped ? current : requested;
if (monthIndex(from) > monthIndex(to)) {
    throw new Error(`--from ${keyAt(monthIndex(from))} is after --to ${keyAt(monthIndex(to))}`);
}

const months = [];
for (let index = monthIndex(from); index <= monthIndex(to); index++) months.push(keyAt(index));

// ---------------------------------------------------------------------------
// The spreadsheet

const env = loadEnv();
const spreadsheetId = argValue("spreadsheet", env.GOOGLE_SHEETS_ORDERS_SPREADSHEET_ID);
if (!spreadsheetId) throw new Error("pass --spreadsheet <id> or set GOOGLE_SHEETS_ORDERS_SPREADSHEET_ID in apps/admin/.env");

const token = await googleAccessToken(env);
const meta = await sheetsGet(token, spreadsheetId, "?fields=properties.title,sheets.properties.title");
const titles = meta.sheets.map((sheet) => sheet.properties.title);

// Safety rail: the logbook is the spreadsheet carrying the ORDERS tab. Any
// other document must not grow a rates tab that belongs elsewhere.
if (!titles.includes("ORDERS")) {
    throw new Error(
        `refusing to run: "${meta.properties.title}" has no ORDERS tab — check --spreadsheet / GOOGLE_SHEETS_ORDERS_SPREADSHEET_ID`,
    );
}

console.log(`spreadsheet: ${meta.properties.title} (${spreadsheetId})`);
console.log(DRY ? "mode:        DRY RUN — nothing is written\n" : "mode:        WRITE\n");

const hasRatesTab = titles.includes(RATES_TAB);
const existingRows = hasRatesTab
    ? await getValues(
          token,
          spreadsheetId,
          RATES_TAB,
          "A1:F",
          "?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER",
      )
    : [];

// Last row wins, the way the app reads the tab, so a correction pasted below
// an older row takes effect without deleting anything
const pinned = new Map();
for (const [at, row] of existingRows.entries()) {
    const key = String(row?.[0] ?? "").trim();
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    if (pinned.has(key)) console.warn(`${RATES_TAB} row ${at + 1}: ${key} appears twice — the last row wins`);
    pinned.set(key, row);
}

const missing = months.filter((key) => !pinned.has(key));

console.log(hasRatesTab ? `${RATES_TAB}:  ${pinned.size} month(s) already pinned` : `${RATES_TAB}:  tab does not exist yet`);
console.log(`range:       ${months[0]} → ${months.at(-1)} (${months.length} months), ${missing.length} to fetch`);
if (capped) console.log(`             --to ${keyAt(monthIndex(requested))} is in the future — capped at ${CURRENT}`);

if (!missing.length) {
    console.log("\nnothing to do — every month in the range is already pinned.");
    process.exit(0);
}

// ---------------------------------------------------------------------------
// Fetch

const fetched = [];
const failed = [];

const yahooMonths = missing.filter((key) => key < FEED_FIRST_MONTH);
const feedMonths = missing.filter((key) => key >= FEED_FIRST_MONTH);

if (yahooMonths.length) {
    console.log(`\nYahoo Finance: ${yahooMonths.length} month(s), ${yahooMonths[0]} → ${yahooMonths.at(-1)}...`);
    const firstIndex = monthIndex(parseMonth(yahooMonths[0], "month"));
    const lastIndex = monthIndex(parseMonth(yahooMonths.at(-1), "month"));

    let mznCloses = [];
    let zarCloses = [];
    try {
        [mznCloses, zarCloses] = await Promise.all([
            fetchYahooCloses("USDMZN=X", firstIndex, lastIndex),
            fetchYahooCloses("USDZAR=X", firstIndex, lastIndex),
        ]);
    } catch (error) {
        console.warn(`  ${error.message}`);
    }

    for (const key of yahooMonths) {
        const mzn = firstCloseIn(mznCloses, key);
        const zar = firstCloseIn(zarCloses, key);
        if (!mzn || !zar) {
            failed.push(`${key}: Yahoo has no ${mzn ? "USDZAR" : "USDMZN"}=X close inside the month`);
            continue;
        }
        // The two symbols can open on different days; the later one dates the row
        const quotedOn = mzn.day > zar.day ? mzn.day : zar.day;
        fetched.push({ key, usdMzn: round4(mzn.close), usdZar: round4(zar.close), source: "yahoo", quotedOn });
    }
}

if (feedMonths.length) {
    console.log(`\ncurrency feed: ${feedMonths.length} month(s), ${feedMonths[0]} → ${feedMonths.at(-1)}...`);
    for (const key of feedMonths) {
        const rate = await fetchFeedRate(key);
        if (rate) fetched.push(rate);
        else failed.push(`${key}: no quote for ${dayOne(key)} or the ${FEED_LOOKAHEAD_DAYS - 1} days after it`);
    }
}

// ---------------------------------------------------------------------------
// Report

const warnings = [];
const rows = fetched
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((row) => {
        if (row.usdMzn < SANE_MZN[0] || row.usdMzn > SANE_MZN[1]) {
            warnings.push(`${row.key}: USD→MZN ${row.usdMzn} is outside ${SANE_MZN[0]}–${SANE_MZN[1]}`);
        }
        if (row.usdZar < SANE_ZAR[0] || row.usdZar > SANE_ZAR[1]) {
            warnings.push(`${row.key}: USD→ZAR ${row.usdZar} is outside ${SANE_ZAR[0]}–${SANE_ZAR[1]}`);
        }
        // Note carries the quote date only when it is not the first of the month
        return { ...row, note: row.quotedOn === dayOne(row.key) ? "" : `quoted ${row.quotedOn}` };
    });

const pad = (value, width) => String(value).padEnd(width);
const padStart = (value, width) => String(value).padStart(width);

console.log(`\n${pad("month", 9)}${padStart("USD→MZN", 10)}${padStart("USD→ZAR", 10)}  ${pad("source", 8)}${pad("quoted on", 12)}note`);
for (const row of rows) {
    console.log(
        `${pad(row.key, 9)}${padStart(row.usdMzn.toFixed(4), 10)}${padStart(row.usdZar.toFixed(4), 10)}  ` +
            `${pad(row.source, 8)}${pad(row.quotedOn, 12)}${row.note}`,
    );
}

if (warnings.length) {
    console.log(`\n${warnings.length} rate(s) outside the expected band — check them before writing:`);
    for (const warning of warnings) console.log(`  ${warning}`);
}
if (failed.length) {
    console.log(`\n${failed.length} month(s) could not be fetched:`);
    for (const line of failed) console.log(`  ${line}`);
}
console.log(`\n${rows.length} of ${missing.length} missing month(s) fetched.`);

// ---------------------------------------------------------------------------
// Write

if (DRY) {
    const create = hasRatesTab ? "" : `create "${RATES_TAB}" and `;
    console.log(`\nDRY RUN — re-run with --yes to ${create}append ${rows.length} row(s). Existing months are never touched.`);
    process.exit(failed.length ? 1 : 0);
}

if (!hasRatesTab) {
    console.log(`\ncreating ${RATES_TAB}...`);
    await batchUpdate(token, spreadsheetId, [
        {
            addSheet: {
                properties: {
                    title: RATES_TAB,
                    gridProperties: { rowCount: months.length + 50, columnCount: RATES_HEADER.length },
                },
            },
        },
    ]);
}

// The header also goes in when the tab was already there but empty: a tab
// added by hand carries none, and the app reads row 1 as the header whatever
// it holds — the first month appended into it would never be read back
if (!hasRatesTab || !existingRows.length) {
    await setValues(token, spreadsheetId, RATES_TAB, "A1", [RATES_HEADER]);
}

if (rows.length) {
    console.log(`appending ${rows.length} row(s)...`);
    const pinnedOn = new Date().toISOString();
    await appendValues(
        token,
        spreadsheetId,
        RATES_TAB,
        "A1:F1",
        rows.map((row) => [row.key, row.usdMzn, row.usdZar, row.source, pinnedOn, row.note]),
    );
}

console.log(`\ndone. ${pinned.size + rows.length} of ${months.length} months in ${RATES_TAB}.`);
if (failed.length) process.exit(1);
