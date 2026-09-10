import { currentYear } from "@/frontend/pages/analytics/types";

/**
 * The board's shared vocabulary: the RSC page prefetches with these builders
 * and the client cards query with them, so both sides hash to the same key
 * and nothing refetches on hydration.
 */

/** Rows in the "latest" table — a glance, not a list. */
export const LATEST_LIMIT = 5;

/**
 * The board is always the current year; it has no year control of its own.
 * The number is the analytics page's own, rather than a `new Date()` here, so
 * the chart on this page and the chart on that one ask for the same twelve
 * months and share one entry in the cache.
 */
export const yearInput = () => ({ year: currentYear() });

/**
 * The newest orders of the list this organization type lands on: everything a
 * client filed, or the requests waiting on a carrier's answer — a carrier has
 * no "all" page. Leaving the section out is what lets one builder serve both,
 * because the procedure resolves each type's own default.
 */
export const latestInput = () => ({
    sort: "newest" as const,
    dir: "desc" as const,
    page: 1,
    pageSize: LATEST_LIMIT,
});
