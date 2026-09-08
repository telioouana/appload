import "server-only";

import { inArray } from "drizzle-orm";

import { fxDailyRate } from "@workspace/db/fx";
import type { CreateFxDailyRate } from "@workspace/db/fx";
import type { db as Database } from "@workspace/db/db";

import { FEED_FIRST_DAY, fetchDailyRate } from "@/lib/metrics/fx";
import { maputoToday } from "@/frontend/pages/kpis/types";

/**
 * Keeps `fx_daily_rate` covering the loading days a KPI report is about.
 *
 * The history is loaded once per environment by
 * packages/db/scripts/seed-daily-rates.mjs; what this adds is the top-up for
 * days that happened since — an order loading today is in the report before
 * any seed has run again. A handful of days per request, bounded the way the
 * metrics rate cache is bounded: compute inside the query, remember failures
 * for a quarter of an hour, stale beats empty.
 *
 * Nothing here throws. A day that stays missing is not a broken page: the
 * report's rate join borrows the nearest earlier day and the page prints how
 * many transports were converted that way.
 */

type Db = typeof Database;

/** Fetches per request. Two page loads cover the days a long weekend adds. */
const MAX_FETCHES = 10;

/**
 * Wall-clock budget for those fetches. The CDN answers in well under a
 * second, but a hung one must not hold a user-facing query for ten timeouts:
 * whatever was not reached heals on the next request.
 */
const DEADLINE_MS = 8_000;

/**
 * How long a day that would not fetch is left alone. Without it every report
 * would pay two timeouts per unreachable day, and a report covers hundreds.
 */
const FAILURE_TTL_MS = 15 * 60 * 1000;

/** How many failures to remember before the expired ones are swept. */
const FAILURE_LIMIT = 200;

// Module scope, so the memory lives as long as the serverless instance
const rateFailures = new Map<string, number>();

function reason(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`;

    return String(error);
}

function failedRecently(day: string): boolean {
    const at = rateFailures.get(day);

    if (at === undefined) {
        return false;
    }

    if (Date.now() - at < FAILURE_TTL_MS) {
        return true;
    }

    rateFailures.delete(day);

    return false;
}

function rememberFailure(day: string): void {
    if (rateFailures.size >= FAILURE_LIMIT) {
        const now = Date.now();

        for (const [seen, at] of rateFailures) {
            if (now - at >= FAILURE_TTL_MS) rateFailures.delete(seen);
        }
    }

    rateFailures.set(day, Date.now());
}

/**
 * Makes sure `days` ("yyyy-mm-dd") have a rate, fetching the few that do not.
 * Days the feed cannot answer for — before its history, or in the future —
 * are skipped without spending a request: the ones before it belong to the
 * seed script, which reads them from Yahoo instead.
 */
export async function ensureDailyRates(db: Db, days: string[]): Promise<void> {
    const today = maputoToday();
    const wanted = [...new Set(days)].filter((day) => day >= FEED_FIRST_DAY && day <= today).sort();

    if (wanted.length === 0) {
        return;
    }

    try {
        const stored = await db.select({ day: fxDailyRate.day }).from(fxDailyRate).where(inArray(fxDailyRate.day, wanted));
        const have = new Set(stored.map((row) => row.day));
        const missing = wanted.filter((day) => !have.has(day) && !failedRecently(day));

        if (missing.length === 0) {
            return;
        }

        // Newest first: a gap at the end of the range is the one the seed has
        // not caught up with yet, and the one this report is most likely to
        // be looking at
        const budget = missing.slice(-MAX_FETCHES).reverse();
        const deadline = Date.now() + DEADLINE_MS;
        const rows: CreateFxDailyRate[] = [];

        for (const day of budget) {
            if (Date.now() > deadline) break;

            // The budget goes into the request too, so a day the CDN never
            // answers cannot spend two full timeouts of its own
            const rate = await fetchDailyRate(day, deadline);

            if (!rate) {
                rememberFailure(day);

                continue;
            }

            rateFailures.delete(day);

            rows.push({
                day,
                usdMzn: rate.usdMzn.toFixed(6),
                usdZar: rate.usdZar.toFixed(6),
                source: "feed",
                // The feed answers a day it lacks with the nearest one it has
                quotedOn: rate.quotedOn,
            });
        }

        if (rows.length > 0) {
            // Another request may have written the same day a moment ago
            await db.insert(fxDailyRate).values(rows).onConflictDoNothing();
        }
    } catch (error) {
        console.warn(`[kpis] could not top up the daily rates: ${reason(error)}`);
    }
}
