import "server-only";

import { inArray } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import { fxDailyRate, type FxDailyRate } from "@workspace/db/fx";
import { ensureDailyRates } from "@workspace/domain/kpis/fx";
import { FEED_FIRST_DAY } from "@workspace/domain/kpis/rates-feed";

import type { MonthRate } from "@/frontend/pages/metrics/types";

/**
 * Each month converts at the rate of its first day, read from
 * `fx_daily_rate` — the table the KPIs page converts every loading day with,
 * so both pages quote one set of rates. The history is seeded per
 * environment (packages/db/scripts/seed-daily-rates.mjs) and recent days are
 * topped up here the way the KPIs page tops them up.
 */

type Db = typeof Database;

/**
 * A carried row is a weekend or holiday holding the previous close; it came
 * from whichever source quoted that close, which the seed switches from
 * Yahoo to the feed on the feed's first day.
 */
const sourceOf = (row: FxDailyRate): MonthRate["source"] => {
    if (row.source !== "carry") return row.source;

    return row.quotedOn >= FEED_FIRST_DAY ? "feed" : "yahoo";
};

const toMonthRate = (row: FxDailyRate): MonthRate => ({
    usdMzn: Number(row.usdMzn),
    usdZar: Number(row.usdZar),
    source: sourceOf(row),
    pinnedOn: row.fetchedAt.toISOString(),
    provisional: false,
});

/**
 * The rate of every month in `monthKeys` ("yyyy-mm"). A month whose first day
 * the table still lacks — the top-up could not reach the feed — borrows the
 * nearest earlier month's rate (the first month's, before any) and is marked
 * provisional, so the page prints ≈ instead of a gap.
 */
export async function monthRates(db: Db, monthKeys: string[]): Promise<Record<string, MonthRate>> {
    if (monthKeys.length === 0) return {};

    const days = monthKeys.map((key) => `${key}-01`);

    await ensureDailyRates(db, days);

    const rows = await db.select().from(fxDailyRate).where(inArray(fxDailyRate.day, days));
    const byMonth = new Map(rows.map((row) => [row.day.slice(0, 7), toMonthRate(row)]));
    const known = [...byMonth.keys()].sort();

    if (known.length === 0) {
        throw new Error("[metrics] fx_daily_rate holds no rate for any month on the timeline — run seed-daily-rates.mjs");
    }

    const rates: Record<string, MonthRate> = {};

    for (const key of monthKeys) {
        const own = byMonth.get(key);

        if (own) {
            rates[key] = own;
            continue;
        }

        const borrowed = known.filter((month) => month < key).at(-1) ?? known[0]!;

        rates[key] = { ...byMonth.get(borrowed)!, provisional: true };
    }

    return rates;
}
