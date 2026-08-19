import type { TRUCK_AGE } from "@workspace/db/types";

/**
 * Business rule shared with the conecta app: trucks from 2015 onwards are
 * classified "recent" (feeds the age factor in pricing).
 */
export const truckAgeFromYear = (year: number | null): (typeof TRUCK_AGE)[number] | undefined =>
    year === null ? undefined : year >= 2015 ? "recent" : "not-recent";
