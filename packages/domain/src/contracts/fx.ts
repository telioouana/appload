import "server-only";
import { desc } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import { fxDailyRate } from "@workspace/db/fx";
import type { CURRENCY } from "@workspace/db/types";
import { ensureDailyRates } from "@workspace/domain/kpis/fx";

import { todayInMaputo } from "@workspace/domain/contracts/price";

type Db = typeof Database;
type Currency = (typeof CURRENCY)[number];

export type LatestRate = { day: string; usdMzn: number; usdZar: number };

/**
 * The newest rate on file, after topping the table up to today. Null when
 * nothing was ever stored: the strip then shows its lines unconverted.
 */
export async function latestRate(db: Db): Promise<LatestRate | null> {
    await ensureDailyRates(db, [todayInMaputo()]);
    const [row] = await db.select().from(fxDailyRate).orderBy(desc(fxDailyRate.day)).limit(1);

    return row ? { day: row.day, usdMzn: Number(row.usdMzn), usdZar: Number(row.usdZar) } : null;
}

/** Rates are local units per dollar, so meticais per rand is the ratio of the two. */
export const toMzn = (currency: Currency, amount: number, rate: LatestRate): number =>
    currency === "MZN" ? amount : currency === "USD" ? amount * rate.usdMzn : (amount * rate.usdMzn) / rate.usdZar;
