import "server-only";

import { fetchOpeningRate, feedCovers } from "@/lib/metrics/fx";
import { appendRateRows, currentMaputoMonth, ensureRatesTab } from "@/lib/metrics/sheet";
import type { MonthRate, RateRow } from "@/frontend/pages/metrics/types";

/**
 * One rate per month of the timeline, self-healing and bounded.
 *
 * The `MONTHLY RATES` tab is the source of truth: whatever is pinned there
 * wins, including a number Claire typed over by hand. Months it does not
 * cover are fetched from the currency feed and appended, a handful per
 * request, so the tab fills itself over the first few page loads instead of
 * needing a cron. Whatever is still missing borrows a neighbour's rate and
 * is flagged `provisional`, which the rates card prints as a warning — an
 * approximate figure beats an empty column, and it repairs itself.
 *
 * Same shape as the route cache in map/server/procedures.ts: compute inside
 * the query, remember failures for a quarter of an hour, stale beats empty.
 */

/** Fetches per request. Six page loads pin half a year without anyone waiting. */
const MAX_FETCHES = 6;

/**
 * Wall-clock budget for those fetches. The CDN answers in well under a
 * second, but a hung one must not hold a user-facing query for six timeouts:
 * whatever was not reached stays provisional this request and heals on the
 * next one, which is the designed behaviour anyway.
 */
const DEADLINE_MS = 10_000;

/**
 * How long a month that would not fetch is left alone. Without it every
 * request would pay two timeouts per unreachable month, and the page embeds
 * the whole timeline.
 */
const FAILURE_TTL_MS = 15 * 60 * 1000;

/** How many failures to remember before the expired ones are swept. */
const FAILURE_LIMIT = 200;

// Module scope, so the memory lives as long as the serverless instance
const rateFailures = new Map<string, number>();

/**
 * Until when appending is not worth attempting. Writing is a nicety, but
 * fetching a rate that cannot be stored is not: the tab never gains the row,
 * so the very same months would be fetched again on the next request, and
 * the one after that, for as long as the service account lacks editor rights
 * on the spreadsheet. Same quarter of an hour the fetch memo uses.
 */
let pinBlockedUntil = 0;

/**
 * Months being fetched or pinned right now. Two cold requests landing
 * together would otherwise both find the same months missing, both fetch
 * them and both append them — and the tab is append-only, so the duplicate
 * rows would stay. A request that finds a month claimed leaves it provisional
 * for now; the claim is released as soon as the row is in the sheet.
 */
const inFlightMonths = new Set<string>();

function reason(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`;

    return String(error);
}

function failedRecently(month: string): boolean {
    const at = rateFailures.get(month);

    if (at === undefined) {
        return false;
    }

    if (Date.now() - at < FAILURE_TTL_MS) {
        return true;
    }

    rateFailures.delete(month);

    return false;
}

function rememberFailure(month: string): void {
    if (rateFailures.size >= FAILURE_LIMIT) {
        const now = Date.now();

        for (const [seen, at] of rateFailures) {
            if (now - at >= FAILURE_TTL_MS) rateFailures.delete(seen);
        }
    }

    rateFailures.set(month, Date.now());
}

/**
 * The tab is append-only and hand-editable, so a month can appear twice —
 * an override typed under the row the app wrote. The last one wins, which is
 * the one Claire added most recently.
 */
function pinnedByMonth(rows: RateRow[]): Map<string, RateRow> {
    const byMonth = new Map<string, RateRow>();
    let duplicates = 0;

    for (const row of rows) {
        if (byMonth.has(row.month)) duplicates += 1;

        byMonth.set(row.month, row);
    }

    if (duplicates > 0) {
        console.warn(`[metrics] MONTHLY RATES holds ${duplicates} duplicate month row(s) — the last of each wins`);
    }

    return byMonth;
}

const asMonthRate = (row: RateRow, provisional: boolean): MonthRate => ({
    usdMzn: row.usdMzn,
    usdZar: row.usdZar,
    source: row.source,
    pinnedOn: row.pinnedOn,
    provisional,
});

/**
 * The closest pinned month to borrow from: the one before, because a rate
 * drifts forward from where it was, and only failing that the one after
 * (which is what the pre-2024 months take until the seed script runs).
 */
function nearestPinned(month: string, sorted: string[], byMonth: Map<string, RateRow>): RateRow | null {
    let earlier: string | null = null;
    let later: string | null = null;

    for (const key of sorted) {
        if (key < month) {
            earlier = key;
        } else if (key > month) {
            later = key;

            break;
        }
    }

    const chosen = earlier ?? later;

    return chosen === null ? null : (byMonth.get(chosen) ?? null);
}

/** Writing to Claire's spreadsheet is a nicety, not a precondition of the page. */
async function pinInSheet(rows: RateRow[]): Promise<void> {
    try {
        await ensureRatesTab();
        await appendRateRows(rows);

        pinBlockedUntil = 0;
    } catch (error) {
        // The rows still serve this request; what stops is fetching more of
        // them until there is somewhere to put them
        pinBlockedUntil = Date.now() + FAILURE_TTL_MS;

        console.warn(`[metrics] could not pin ${rows.length} rate(s) in the sheet, pausing the fetches for ${FAILURE_TTL_MS / 60_000} minutes: ${reason(error)}`);
    }
}

/**
 * A rate for every month in `monthKeys`, keyed by month. Never returns a
 * partial map: a month with nothing to convert it by is an error, because a
 * missing key would print an empty revenue column with no explanation.
 */
export async function resolveRates(monthKeys: string[], rows: RateRow[]): Promise<Record<string, MonthRate>> {
    const byMonth = pinnedByMonth(rows);
    const wanted = [...new Set(monthKeys)].sort();
    const fetched: RateRow[] = [];

    // No budget at all while the last append was refused: an unwritable tab
    // would otherwise re-fetch the same six months on every single request,
    // and the borrowed-rate path below already renders the page correctly
    let budget = Date.now() < pinBlockedUntil ? 0 : MAX_FETCHES;

    const claimed: string[] = [];
    const deadline = Date.now() + DEADLINE_MS;

    try {
        // Oldest first, so the tab fills forward and the gap the page shows
        // shrinks from the left over successive loads
        for (const month of wanted) {
            if (budget === 0 || Date.now() > deadline) break;

            // Months before the feed's history (the seed script's job) and
            // the months of the future never had a day-1 quote to fetch; a
            // month another request is pinning right now is its to finish
            if (byMonth.has(month) || !feedCovers(month) || failedRecently(month) || inFlightMonths.has(month)) continue;

            budget -= 1;
            inFlightMonths.add(month);
            claimed.push(month);

            const opening = await fetchOpeningRate(month);

            if (!opening) {
                rememberFailure(month);

                continue;
            }

            rateFailures.delete(month);

            const row: RateRow = {
                month,
                usdMzn: opening.usdMzn,
                usdZar: opening.usdZar,
                source: "feed",
                pinnedOn: new Date().toISOString(),
                // Only worth a note when the feed answered with another day
                // Same words the seed script writes, so the column reads as one
                note: opening.quotedOn === `${month}-01` ? null : `quoted ${opening.quotedOn}`,
            };

            byMonth.set(month, row);
            fetched.push(row);
        }

        if (fetched.length > 0) {
            await pinInSheet(fetched);
        }
    } finally {
        for (const month of claimed) inFlightMonths.delete(month);
    }

    const resolved: Record<string, MonthRate> = {};
    const missing: string[] = [];

    for (const month of wanted) {
        const row = byMonth.get(month);

        if (row) {
            resolved[month] = asMonthRate(row, false);
        } else {
            missing.push(month);
        }
    }

    if (missing.length === 0) {
        return resolved;
    }

    const sorted = [...byMonth.keys()].sort();
    let lastResort: RateRow | null = null;

    // Nothing pinned and nothing fetched — a first run whose timeline is all
    // pre-feed months. Today's quote converts everything roughly, which is
    // far better than a page that refuses to render
    if (sorted.length === 0) {
        const month = currentMaputoMonth();
        const opening = await fetchOpeningRate(month);

        if (!opening) {
            throw new Error("[metrics] no exchange rate available: MONTHLY RATES is empty and the currency feed cannot be reached");
        }

        lastResort = {
            month,
            usdMzn: opening.usdMzn,
            usdZar: opening.usdZar,
            source: "feed",
            pinnedOn: new Date().toISOString(),
            note: null,
        };
    }

    for (const month of missing) {
        const row = lastResort ?? nearestPinned(month, sorted, byMonth);

        if (!row) {
            throw new Error(`[metrics] no exchange rate available for ${month}`);
        }

        resolved[month] = asMonthRate(row, true);
    }

    return resolved;
}
