import { date, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Where a stored day's rate came from — see `fxDailyRate.source`. */
export const FX_RATE_SOURCE = ["feed", "yahoo", "carry", "manual"] as const;
export type FxRateSource = (typeof FX_RATE_SOURCE)[number];

/**
 * One row per calendar day: how many meticais and rand one US dollar bought
 * that day. The KPIs page needs it because a company's trips are priced in
 * whichever currency the deal used, and a report mixing MZN, ZAR and USD legs
 * can only add up in one of them — so every leg is converted to USD at the
 * rate of its own loading day (`amount / usd_mzn`, `amount / usd_zar`), and a
 * 2022 trip keeps its 2022 value however the metical moves afterwards.
 *
 * Days are calendar days, not trading days: the market is shut at weekends
 * but cargo still loads, so every day in the range carries a row. `source`
 * says how it was obtained — "feed" and "yahoo" are quotes of that very day,
 * "carry" is the previous close held over a weekend or a holiday, "manual" is
 * a number entered by hand. `quotedOn` is the day the source actually quoted,
 * equal to `day` except on carried rows, so a borrowed rate is always visible
 * as one.
 *
 * The history is loaded once per environment by
 * packages/db/scripts/seed-daily-rates.mjs; the app tops up recent days by
 * itself (apps/admin/src/lib/kpis/fx.ts). A day the table lacks entirely is
 * not an error: the report SQL borrows the nearest earlier row and marks
 * those transports provisional.
 */
export const fxDailyRate = pgTable("fx_daily_rate", {
    day: date("day", { mode: "string" }).primaryKey(),
    usdMzn: numeric("usd_mzn", { precision: 12, scale: 6 }).notNull(),
    usdZar: numeric("usd_zar", { precision: 12, scale: 6 }).notNull(),
    source: text("source", { enum: FX_RATE_SOURCE }).notNull(),
    // The day the quote belongs to; differs from `day` only on carried rows
    quotedOn: date("quoted_on", { mode: "string" }).notNull(),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
});

export type FxDailyRate = typeof fxDailyRate.$inferSelect;
export type CreateFxDailyRate = typeof fxDailyRate.$inferInsert;
