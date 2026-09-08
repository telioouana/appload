import { z } from "zod";
import { count, eq, inArray, sql } from "drizzle-orm";

import { order } from "@workspace/db/orders";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";

import { conditionCount, statusCount, thisYear } from "@/lib/orders/predicates";
import { ACTIVE_STATUSES } from "@/frontend/pages/orders/types";
import { LOST_STATUSES, type MonthlyOrders, type MonthPoint } from "@/frontend/pages/dashboard/types";

const YearInput = z.object({ year: z.number().int().min(2000).max(2100).optional() });

const emptyTotals = (): Omit<MonthPoint, "month"> => ({
    completed: 0,
    delivered: 0,
    active: 0,
    prospect: 0,
    lost: 0,
    total: 0,
});

export const dashboardRouter = createTRPCRouter({
    /**
     * The year's orders bucketed by loading month and outcome — the chart's
     * only read. Grouped on the expected loading date, not `created_at`:
     * every period on the orders pages is the loading date, and
     * `order.year = year` is the scope `orders.stats`, the cashflow strip
     * and `/orders/all?year=` already use, so the bars agree with the
     * numbers beside them.
     */
    monthly: authorizedProcedure("order", ["list"])
        .input(YearInput)
        .query(async ({ ctx, input }): Promise<MonthlyOrders> => {
            const year = input.year ?? thisYear();
            const month = sql<number>`extract(month from ${order.expectedLoadingDate})::int`.mapWith(Number);

            const rows = await ctx.db
                .select({
                    month,
                    completed: statusCount("completed"),
                    delivered: statusCount("delivered"),
                    // Booked through to offloading: one "in progress" band
                    active: conditionCount(inArray(order.status, ACTIVE_STATUSES)),
                    prospect: statusCount("prospect"),
                    lost: conditionCount(inArray(order.status, LOST_STATUSES)),
                    total: count(),
                })
                .from(order)
                .where(eq(order.year, year))
                .groupBy(month)
                .orderBy(month);

            // Twelve rows whatever the data holds, so a quiet month is a gap
            // in the chart rather than a missing bar the axis shifts around
            const months: MonthPoint[] = Array.from({ length: 12 }, (_, index) => ({
                month: index + 1,
                ...emptyTotals(),
            }));
            const totals = emptyTotals();

            for (const row of rows) {
                const point = months[row.month - 1];
                if (!point) continue;

                point.completed = row.completed;
                point.delivered = row.delivered;
                point.active = row.active;
                point.prospect = row.prospect;
                point.lost = row.lost;
                point.total = row.total;

                totals.completed += row.completed;
                totals.delivered += row.delivered;
                totals.active += row.active;
                totals.prospect += row.prospect;
                totals.lost += row.lost;
                totals.total += row.total;
            }

            return { year, months, totals };
        }),
});
