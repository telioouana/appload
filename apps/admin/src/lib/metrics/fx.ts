import "server-only";

import {
    FEED_FIRST_DAY,
    FEED_FIRST_MONTH,
    fetchDailyRate,
    type OpeningRate,
} from "@workspace/domain/kpis/rates-feed";

import { currentMaputoMonth } from "@/lib/metrics/sheet";

/**
 * One month's opening exchange rate, from the keyless daily currency feed.
 *
 * The feed publishes a file per calendar day, so asking for a month on the
 * 20th still returns the quote of day 1 — which is the whole point: a month's
 * money is converted once, at the rate it opened with, and never moves again.
 * No key, no account, two hosts; nothing here throws, because a rate that
 * cannot be fetched is a footnote on the page, not a broken page.
 *
 * The day-level fetch itself lives in `@workspace/domain/kpis/rates-feed`,
 * shared with the KPI reports' own top-up.
 */

/**
 * Whether the feed can be expected to answer for this month at all. Callers
 * check it before spending their fetch budget: a month outside the window is
 * a certainty, not a failure worth retrying in a quarter of an hour.
 */
export const feedCovers = (month: string): boolean =>
    /^\d{4}-\d{2}$/.test(month) && month >= FEED_FIRST_MONTH && month <= currentMaputoMonth();

/**
 * The USD→MZN and USD→ZAR quotes of the first day of `month` ("2026-09"),
 * or null when the feed has no answer — out of range, offline, or a payload
 * without the two currencies.
 */
export async function fetchOpeningRate(month: string): Promise<OpeningRate | null> {
    if (!/^\d{4}-\d{2}$/.test(month)) {
        console.warn(`[fx] "${month}" is not a YYYY-MM month key`);

        return null;
    }

    // Before the feed existed, and after the month Claire is living in —
    // neither has a day-1 file to fetch
    if (month < FEED_FIRST_MONTH || month > currentMaputoMonth()) {
        return null;
    }

    // The one month whose first day is older than the feed itself
    const first = `${month}-01`;

    return fetchDailyRate(first < FEED_FIRST_DAY ? FEED_FIRST_DAY : first);
}
