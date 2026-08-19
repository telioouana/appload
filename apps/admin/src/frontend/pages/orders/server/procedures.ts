import { z } from "zod";
import { and, count, desc, eq, gte, ilike, inArray, lt, lte, or } from "drizzle-orm";

import { order } from "@workspace/db/orders";
import { CATEGORIES, ORDER_STATUS, PAYMENT_STATUS } from "@workspace/db/types";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";

import { FILTERS, statusFilter } from "@/frontend/pages/orders/types";
import { toTRPCError } from "@/frontend/pages/order/server/procedures";

/**
 * Mirrors the URL contract written by the orders header view:
 * absent params mean "no filter" (paymentBy absent = either side,
 * year absent = current year). `month` and `from`/`to` are mutually
 * exclusive on the client; if both arrive, the explicit range wins.
 */
const ListOrdersSchema = z.object({
    filter: z.enum(FILTERS).default("all"),
    search: z.string().trim().max(120).optional(),
    category: z.enum(CATEGORIES).optional(),
    status: z.enum(ORDER_STATUS).optional(),
    paymentBy: z.enum(["shipper", "carrier"]).optional(),
    payment: z.enum(PAYMENT_STATUS).optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    // Infinite-query pagination: the cursor is the 1-based page index
    cursor: z.number().int().min(1).nullish(),
    limit: z.number().int().min(1).max(100).default(20),
});

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const endOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

export const ordersRouter = createTRPCRouter({
    list: authorizedProcedure("order", ["list"])
        .input(ListOrdersSchema)
        .query(async ({ ctx, input }) => {
            try {
                const year = input.year ?? new Date().getFullYear();
                const statuses = statusFilter(input.filter);

                const conditions = [eq(order.year, year)];

                // The page filter bounds the status set; a selected status pill narrows
                // within it. A status outside the set (hand-edited URL) is ignored.
                conditions.push(
                    input.status && statuses.includes(input.status)
                        ? eq(order.status, input.status)
                        : inArray(order.status, statuses),
                );

                if (input.search) {
                    const term = `%${input.search}%`;
                    conditions.push(
                        or(
                            ilike(order.orderId, term),
                            ilike(order.shipperName, term),
                            ilike(order.carrierName, term),
                            ilike(order.carrierInvoiceNumber, term),
                            ilike(order.shipperInvoiceNumber, term),
                        )!,
                    );
                }

                if (input.category) {
                    conditions.push(eq(order.category, input.category));
                }

                if (input.payment) {
                    conditions.push(
                        input.paymentBy === "shipper" ? eq(order.shipperPaymentStatus, input.payment) :
                            input.paymentBy === "carrier" ? eq(order.carrierPaymentStatus, input.payment) :
                                or(
                                    eq(order.shipperPaymentStatus, input.payment),
                                    eq(order.carrierPaymentStatus, input.payment),
                                )!,
                    );
                }

                if (input.from || input.to) {
                    if (input.from) conditions.push(gte(order.createdAt, startOfDay(input.from)));
                    if (input.to) conditions.push(lte(order.createdAt, endOfDay(input.to)));
                } else if (input.month) {
                    conditions.push(
                        gte(order.createdAt, new Date(year, input.month - 1, 1)),
                        lt(order.createdAt, new Date(year, input.month, 1)),
                    );
                }

                const where = and(...conditions);
                const cursor = input.cursor ?? 1;
                const offset = (cursor - 1) * input.limit;

                const [items, [total]] = await Promise.all([
                    ctx.db
                        .select()
                        .from(order)
                        .where(where)
                        .orderBy(desc(order.year), desc(order.seq))
                        .limit(input.limit)
                        .offset(offset),
                        
                    ctx.db
                        .select({ value: count() })
                        .from(order)
                        .where(where),
                ]);

                const totalCount = total?.value ?? 0;

                return {
                    items,
                    total: totalCount,
                    nextCursor: offset + items.length < totalCount ? cursor + 1 : undefined,
                };
            } catch (error) {
                throw toTRPCError(error);
            }
        }),
});
