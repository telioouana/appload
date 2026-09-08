import "server-only";

import { currentMaputoMonth } from "@/lib/metrics/sheet";

/**
 * One month's opening exchange rate, from the keyless daily currency feed.
 *
 * The feed publishes a file per calendar day, so asking for a month on the
 * 20th still returns the quote of day 1 — which is the whole point: a month's
 * money is converted once, at the rate it opened with, and never moves again.
 * No key, no account, two hosts; nothing here throws, because a rate that
 * cannot be fetched is a footnote on the page, not a broken page.
 */

export type OpeningRate = {
    usdMzn: number;
    usdZar: number;
    /** The date the feed stamped on the file it answered with, "YYYY-MM-DD" */
    quotedOn: string;
};

/**
 * The feed's history begins on 2024-03-02, which makes March 2024 the oldest
 * month it can answer for — quoted on the 2nd rather than the 1st, and the
 * caller writes that date into the row's note. Every earlier day answers 404
 * on both hosts (checked), so those months belong to the seed script, which
 * reads their opening rates from Yahoo instead; asking here would only burn
 * two requests and a timeout each.
 */
export const FEED_FIRST_MONTH = "2024-03";
export const FEED_FIRST_DAY = "2024-03-02";

// Same budget as the maps client: a slow CDN must not hold a user-facing
// query open, and there is a second host to try
const TIMEOUT_MS = 8_000;

/**
 * Whether the feed can be expected to answer for this month at all. Callers
 * check it before spending their fetch budget: a month outside the window is
 * a certainty, not a failure worth retrying in a quarter of an hour.
 */
export const feedCovers = (month: string): boolean =>
    /^\d{4}-\d{2}$/.test(month) && month >= FEED_FIRST_MONTH && month <= currentMaputoMonth();

/** jsDelivr first, then the project's own mirror when the CDN is having a day. */
const endpoints = (day: string) => [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${day}/v1/currencies/usd.min.json`,
    `https://${day}.currency-api.pages.dev/v1/currencies/usd.min.json`,
];

type FeedPayload = {
    date?: string;
    usd?: Record<string, unknown>;
};

function reason(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`;

    return String(error);
}

/** A quote is only usable when it is a finite positive number of meticais/rand per dollar. */
const quote = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

/**
 * The USD→MZN and USD→ZAR quotes of one calendar day ("2026-09-07"), or null
 * when the feed has no answer — outside its history, offline, or a payload
 * without the two currencies. The caller is expected to have checked the day
 * is one the feed can cover; this only asks the two hosts.
 *
 * The KPIs page converts every trip at its own loading day, which is why this
 * is a day and not a month (`lib/kpis/fx.ts`).
 *
 * `deadline` (an epoch millisecond) is for callers fetching several days under
 * a budget of their own: without it one unreachable day costs both timeouts
 * and overruns that budget by itself.
 */
export async function fetchDailyRate(day: string, deadline?: number): Promise<OpeningRate | null> {
    for (const url of endpoints(day)) {
        const budget = deadline === undefined ? TIMEOUT_MS : Math.min(TIMEOUT_MS, deadline - Date.now());

        if (budget <= 0) {
            break;
        }

        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(budget) });

            if (!response.ok) {
                console.warn(`[fx] ${url} responded ${response.status}`);

                continue;
            }

            const payload = (await response.json().catch(() => null)) as FeedPayload | null;
            const usdMzn = quote(payload?.usd?.mzn);
            const usdZar = quote(payload?.usd?.zar);

            if (usdMzn === null || usdZar === null) {
                console.warn(`[fx] the ${day} quote carries no usable MZN/ZAR pair`);

                continue;
            }

            return {
                usdMzn,
                usdZar,
                // The feed answers a missing day with the nearest one it has,
                // and says so in `date` — worth recording next to the rate
                quotedOn: typeof payload?.date === "string" ? payload.date : day,
            };
        } catch (error) {
            console.warn(`[fx] request for ${day} failed: ${reason(error)}`);
        }
    }

    return null;
}

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
