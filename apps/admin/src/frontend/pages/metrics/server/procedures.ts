import { TRPCError } from "@trpc/server";

import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";

import { computeOverview } from "@/lib/metrics/compute";
import { resolveRates } from "@/lib/metrics/rates";
import { currentMaputoMonth, readSnapshot } from "@/lib/metrics/sheet";
import { monthKey, type MetricsOverview } from "@/frontend/pages/metrics/types";

/** Where the numbers come from — the header links straight to the logbook. */
const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

export const metricsRouter = createTRPCRouter({
    /**
     * The whole timeline in one payload: every card on the page reads a
     * different slice of the same months, so a second procedure would only
     * re-read the same spreadsheet.
     *
     * Gated like the dashboard — anyone who can list orders already sees
     * sales and commission per year on the orders pages.
     */
    overview: authorizedProcedure("order", ["list"]).query(async (): Promise<MetricsOverview> => {
        try {
            const snapshot = await readSnapshot();

            // Rates are resolved inside the query, the way the map resolves
            // routes: missing months heal themselves, and a month that will
            // not resolve borrows a neighbour rather than blanking a row
            const rates = await resolveRates(
                snapshot.months.map((month) => monthKey(month.year, month.month)),
                snapshot.rates,
            );

            return computeOverview({
                months: snapshot.months,
                rates,
                parties: snapshot.parties,
                currentMonth: currentMaputoMonth(),
                fetchedAt: snapshot.fetchedAt,
                stale: snapshot.stale,
                sheetUrl: sheetUrl(snapshot.spreadsheetId),
            });
        } catch (error) {
            if (error instanceof TRPCError) throw error;

            const message = error instanceof Error ? error.message : "METRICS_UNAVAILABLE";

            // An unset env var, a spreadsheet the service account cannot
            // open, a feed with nothing to convert by: all of them mean the
            // page cannot be built at all, and the view has one error card
            console.error(`[metrics] overview failed: ${message}`);

            throw new TRPCError({ code: "PRECONDITION_FAILED", message });
        }
    }),
});
