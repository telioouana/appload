import "server-only";

/**
 * One calendar day's exchange rate, from the keyless daily currency feed.
 *
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

const MAPUTO_MONTH = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Maputo", year: "numeric", month: "2-digit" });

/**
 * "2026-09" in Maputo time — Claire's calendar, not whichever region the
 * server booted in. A copy of the metrics page's helper, so this module can
 * be read without dragging the Google Sheets client along with it.
 */
export const currentMaputoMonth = (): string => MAPUTO_MONTH.format(new Date());

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
 * is a day and not a month (`kpis/fx.ts`).
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
