import { TRPCError } from "@trpc/server";

import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";

import { maputoToday } from "@workspace/domain/kpis/types";

import { computeOverview } from "@/lib/metrics/compute";
import { aggregateOrders, readOrderRows, timeline } from "@/lib/metrics/orders";
import { monthRates } from "@/lib/metrics/rates";
import { monthKey, type MetricsOverview } from "@/frontend/pages/metrics/types";

export const metricsRouter = createTRPCRouter({
    /**
     * The whole timeline in one payload: every card on the page reads a
     * different slice of the same months, folded from the orders table.
     *
     * Gated like the dashboard — anyone who can list orders already sees
     * sales and commission per year on the orders pages.
     */
    overview: authorizedProcedure("order", ["list"]).query(async ({ ctx }): Promise<MetricsOverview> => {
        try {
            const { months: folded, parties } = aggregateOrders(await readOrderRows(ctx.db));
            // "2026-09" on Claire's calendar, not the server's
            const currentMonth = maputoToday().slice(0, 7);
            const months = timeline(folded, currentMonth);

            // Rates are resolved inside the query, the way the map resolves
            // routes: missing days are topped up, and a month that will not
            // resolve borrows a neighbour rather than blanking a row
            const rates = await monthRates(ctx.db, months.map((month) => monthKey(month.year, month.month)));

            return computeOverview({
                months,
                rates,
                parties,
                currentMonth,
            });
        } catch (error) {
            if (error instanceof TRPCError) throw error;

            const message = error instanceof Error ? error.message : "METRICS_UNAVAILABLE";

            // A database that will not answer, or no rate for any month: the
            // page cannot be built at all, and the view has one error card
            console.error(`[metrics] overview failed: ${message}`);

            throw new TRPCError({ code: "PRECONDITION_FAILED", message });
        }
    }),
});
