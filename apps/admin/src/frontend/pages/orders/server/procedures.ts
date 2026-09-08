import { z } from "zod";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, lt, lte, ne, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { order } from "@workspace/db/orders";
import { organization } from "@workspace/db/users";
import { CATEGORIES, CURRENCY, ORDER_STATUS, ROUTE_TYPE } from "@workspace/db/types";
import type { db as Database } from "@workspace/db/db";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";

import { getSheetsAccessToken } from "@/lib/orders/google-token";
import {
    awaitingPod,
    billable,
    conditionCount,
    disputed,
    flagged,
    insuranceToPay,
    interrupted,
    loadingDue,
    loadingOverdue,
    prospectDueSoon,
    statusCount,
    thisYear,
} from "@/lib/orders/predicates";
import { isPlaceholder } from "@/frontend/pages/partners/types";
import { pendingOfferCount, toTRPCError, transitionOrder } from "@/frontend/pages/order/server/procedures";
import {
    BOOKED_MODES,
    LOADING_WINDOW_DAYS,
    ORDER_SORTS,
    ORDER_STATUS_SECTION,
    OUTSTANDING_STATUSES,
    PAYMENT_FILTERS,
    PAYMENT_PARTIES,
    SECTIONS,
    statusFilter,
} from "@/frontend/pages/orders/types";
import type {
    Cashflow,
    CashflowLine,
    Currency,
    FilterOptions,
    OrderRow,
    OrderSection,
    OrderStats,
    OrderStatus,
    PagedResult,
} from "@/frontend/pages/orders/types";

type Db = typeof Database;

export type BulkTransitionResult =
    | { orderId: string; ok: true; warning?: "SHEET_FAILED" }
    | { orderId: string; ok: false; code: string };

// Rows an export may carry; a year of orders is a few hundred today
const EXPORT_LIMIT = 2000;

// Escape LIKE wildcards so user input matches literally
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const year = z.number().int().min(2000).max(2100);

/**
 * Mirrors the URL contract written by the list controls (see
 * `ordersListInput`): the section comes from the route, absent params mean
 * "no filter", and `year` defaults to the current year — the list is
 * always one year's orders. `month` and `from`/`to` are exclusive on the
 * client; an explicit range wins when both arrive.
 */
const OrdersInput = z.object({
    section: z.enum(SECTIONS).default("all"),
    search: z.string().trim().max(120).optional(),
    status: z.enum(ORDER_STATUS).optional(),
    category: z.enum(CATEGORIES).optional(),
    paymentBy: z.enum(PAYMENT_PARTIES).optional(),
    payment: z.enum(PAYMENT_FILTERS).optional(),
    year: year.optional(),
    month: z.number().int().min(1).max(12).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    shipper: z.string().max(64).optional(),
    carrier: z.string().max(64).optional(),
    // Days ahead the loading date may be; set by the "loading due" toggle
    loading: z.number().int().positive().max(365).optional(),
    interrupted: z.boolean().optional(),
    flagged: z.boolean().optional(),
    pod: z.literal("pending").optional(),
    // Insurance Appload subscribed to and still has to pay
    insurance: z.literal("pending").optional(),
    // Orders with an active dispute (see order_dispute)
    disputed: z.boolean().optional(),
    hazardous: z.boolean().optional(),
    refrigerated: z.boolean().optional(),
    route: z.enum(ROUTE_TYPE).optional(),
    sort: z.enum(ORDER_SORTS).optional(),
    dir: z.enum(["asc", "desc"]).default("desc"),
    // The 1-based page index; absent means the first page
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).default(25),
});

// Exported as a type only (the schema stays server-side): the dashboard's
// shared input builders `satisfies` it, so a change here breaks them here
export type OrdersInput = z.infer<typeof OrdersInput>;
type Scope = Omit<OrdersInput, "page" | "pageSize" | "sort" | "dir">;
type Paging = { page?: number; pageSize: number };

const YearInput = z.object({ year: year.optional() });

const CashflowInput = z.object({ year: year.optional(), booked: z.enum(BOOKED_MODES).default("include") });

const startOfDay = (value: string) => new Date(`${value}T00:00:00`);
const endOfDay = (value: string) => new Date(`${value}T23:59:59.999`);

const round2 = (value: number) => Math.round(value * 100) / 100;

/** The page index and offset a paged read asked for. */
function paging(input: Paging) {
    const page = input.page ?? 1;
    return { page, offset: (page - 1) * input.pageSize, limit: input.pageSize };
}

function paged<T>(items: T[], total: number, input: Paging): PagedResult<T> {
    const { page } = paging(input);

    return {
        items,
        total,
        page,
        pageSize: input.pageSize,
    };
}

// The projection every list read shares. `satisfies` keeps it and OrderRow
// in step: add a column to one without the other and this stops compiling.
const ROW = {
    id: order.id,
    orderId: order.orderId,
    year: order.year,
    seq: order.seq,
    status: order.status,
    category: order.category,
    description: order.description,
    weight: order.weight,
    weightUnit: order.weightUnit,
    isHazardous: order.isHazardous,
    isRefrigerated: order.isRefrigerated,
    loadingAddress: order.loadingAddress,
    offloadingAddress: order.offloadingAddress,
    distance: order.distance,
    route: order.route,
    tripType: order.tripType,
    expectedLoadingDate: order.expectedLoadingDate,
    expectedOffloadingDate: order.expectedOffloadingDate,
    actualLoadingDate: order.actualLoadingDate,
    actualOffloadingDate: order.actualOffloadingDate,
    shipperId: order.shipperId,
    shipperName: order.shipperName,
    shipperInvoiceNumber: order.shipperInvoiceNumber,
    shipperTotal: order.shipperTotal,
    shipperCurrency: order.shipperCurrency,
    shipperPaymentStatus: order.shipperPaymentStatus,
    shipperRemainingAmount: order.shipperRemainingAmount,
    shipperRemainingPercentage: order.shipperRemainingPercentage,
    carrierId: order.carrierId,
    carrierName: order.carrierName,
    carrierInvoiceNumber: order.carrierInvoiceNumber,
    carrierTotal: order.carrierTotal,
    carrierCurrency: order.carrierCurrency,
    carrierPaymentStatus: order.carrierPaymentStatus,
    carrierRemainingAmount: order.carrierRemainingAmount,
    carrierRemainingPercentage: order.carrierRemainingPercentage,
    driverName: order.driverName,
    driverPhoneNumber: order.driverPhoneNumber,
    truckPlate: order.truckPlate,
    trailerPlate: order.trailerPlate,
    podStatus: order.podStatus,
    flaggedForReview: order.flaggedForReview,
    disputeStatus: order.disputeStatus,
    version: order.version,
    updatedAt: order.updatedAt,
    offerCount: pendingOfferCount,
} satisfies Record<keyof OrderRow, AnyColumn | SQL>;

/** Every condition the list input asks for, as one WHERE clause. */
function scope(input: Scope): SQL | undefined {
    const year = input.year ?? thisYear();
    const statuses = statusFilter(input.section);

    const conditions: (SQL | undefined)[] = [eq(order.year, year)];

    // The section bounds the status set; a chosen status narrows within it.
    // A status outside the section (hand-edited URL) is ignored.
    conditions.push(
        input.status && statuses.includes(input.status)
            ? eq(order.status, input.status)
            : inArray(order.status, statuses),
    );

    if (input.search) {
        const term = `%${escapeLike(input.search)}%`;
        conditions.push(or(
            ilike(order.orderId, term),
            ilike(order.shipperName, term),
            ilike(order.carrierName, term),
            ilike(order.driverName, term),
            ilike(order.truckPlate, term),
            ilike(order.carrierInvoiceNumber, term),
            ilike(order.shipperInvoiceNumber, term),
        ));
    }

    if (input.category) conditions.push(eq(order.category, input.category));
    if (input.shipper) conditions.push(eq(order.shipperId, input.shipper));
    if (input.carrier) conditions.push(eq(order.carrierId, input.carrier));

    if (input.payment) {
        // "outstanding" = pending or partially, on orders that are actually
        // owed — the same rows the cashflow strip counts
        const wanted = input.payment === "outstanding" ? OUTSTANDING_STATUSES : [input.payment];
        const leg = (column: typeof order.shipperPaymentStatus | typeof order.carrierPaymentStatus) => inArray(column, wanted);

        conditions.push(
            input.paymentBy === "shipper" ? leg(order.shipperPaymentStatus)
                : input.paymentBy === "carrier" ? leg(order.carrierPaymentStatus)
                    : or(leg(order.shipperPaymentStatus), leg(order.carrierPaymentStatus)),
        );
        if (input.payment === "outstanding") conditions.push(billable());
    }

    // The period is the loading date — what the rows show — not creation
    if (input.from || input.to) {
        if (input.from) conditions.push(gte(order.expectedLoadingDate, startOfDay(input.from)));
        if (input.to) conditions.push(lte(order.expectedLoadingDate, endOfDay(input.to)));
    } else if (input.month) {
        conditions.push(
            gte(order.expectedLoadingDate, new Date(year, input.month - 1, 1)),
            lt(order.expectedLoadingDate, new Date(year, input.month, 1)),
        );
    }

    if (input.loading) conditions.push(loadingDue(input.loading));
    if (input.interrupted) conditions.push(interrupted());
    if (input.flagged) conditions.push(flagged());
    if (input.pod) conditions.push(awaitingPod());
    if (input.insurance) conditions.push(insuranceToPay(), billable());
    if (input.disputed) conditions.push(disputed());
    if (input.hazardous) conditions.push(eq(order.isHazardous, true));
    if (input.refrigerated) conditions.push(eq(order.isRefrigerated, true));
    if (input.route) conditions.push(eq(order.route, input.route));

    return and(...conditions);
}

// Chain position for the status sort: the enum is declared in trip order
const STATUS_POSITION = sql`array_position(ARRAY[${sql.join(ORDER_STATUS.map((status) => sql`${status}`), sql`, `)}]::text[], ${order.status}::text)`;

/** ORDER BY for a sort key; nulls always sink so an unpriced order never leads. */
function ordering(sort: OrdersInput["sort"], dir: OrdersInput["dir"]): SQL[] {
    const by = (column: AnyColumn | SQL) => (dir === "desc" ? sql`${column} desc nulls last` : sql`${column} asc nulls last`);
    const newest = desc(order.seq);

    switch (sort) {
        case "loading": return [by(order.expectedLoadingDate), newest];
        case "total": return [by(order.shipperTotal), newest];
        case "status": return [by(STATUS_POSITION), newest];
        case "updated": return [by(order.updatedAt), newest];
        default: return [by(order.year), by(order.seq)];
    }
}

async function listOrders(db: Db, input: Scope & Pick<OrdersInput, "sort" | "dir">, limit: number, offset: number) {
    const where = scope(input);

    const [items, [total]] = await Promise.all([
        db.select(ROW)
            .from(order)
            .where(where)
            .orderBy(...ordering(input.sort, input.dir))
            .limit(limit)
            .offset(offset),

        db.select({ value: count() })
            .from(order)
            .where(where),
    ]);

    return { items: items as OrderRow[], total: total?.value ?? 0 };
}

// ---------------------------------------------------------------------------
// Cashflow: what is still to move this year, per currency
// ---------------------------------------------------------------------------

/**
 * What a leg still owes, from canonical inputs: effective total (base +
 * debit notes − credit notes) minus what was paid. The stored
 * `*RemainingAmount` columns are NOT used — they stay null until the first
 * write after booking. Overpaid legs clamp to zero so they never shrink
 * the sum.
 */
const outstanding = (total: AnyColumn, debit: AnyColumn, credit: AnyColumn, paid: AnyColumn) =>
    sql<number>`coalesce(sum(greatest(coalesce(${total}, 0) + ${debit} - ${credit} - coalesce(${paid}, 0), 0)), 0)`.mapWith(Number);

// Legs without a currency are Mozambican by default, like the column defaults
const currencyOf = (column: AnyColumn) => sql<string>`coalesce(${column}::text, 'MZN')`;

const emptyLine = (currency: Currency): CashflowLine => ({
    currency,
    pendingShipper: 0,
    pendingCarrier: 0,
    receivables: 0,
    payables: 0,
    insurance: 0,
    cashflow: 0,
});

const isCurrency = (value: string): value is Currency => (CURRENCY as readonly string[]).includes(value);

/** A currency earns its row by having trips still pending, or money still to move. */
const carries = (line: CashflowLine) =>
    Boolean(line.pendingShipper || line.pendingCarrier || line.receivables || line.payables || line.insurance);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const ordersRouter = createTRPCRouter({
    list: authorizedProcedure("order", ["list"])
        .input(OrdersInput)
        .query(async ({ ctx, input }) => {
            try {
                const { limit, offset } = paging(input);
                const { items, total } = await listOrders(ctx.db, input, limit, offset);

                return paged(items, total, input);
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /**
     * Counts for the status tabs and the attention toggles — one grouped
     * query over the year, so the numbers always agree with each other
     * and with the list they open.
     */
    stats: authorizedProcedure("order", ["list"])
        .input(YearInput)
        .query(async ({ ctx, input }): Promise<OrderStats> => {
            const year = input.year ?? thisYear();

            const byStatusSelect = Object.fromEntries(
                ORDER_STATUS.map((status) => [status, statusCount(status)]),
            ) as Record<OrderStatus, SQL<number>>;

            // The attention keys are prefixed: "loading" is also an order status
            const [row] = await ctx.db
                .select({
                    ...byStatusSelect,
                    total: count(),
                    dueLoading: conditionCount(loadingDue(LOADING_WINDOW_DAYS)),
                    dueInterrupted: conditionCount(interrupted()),
                    dueFlagged: conditionCount(flagged()),
                    duePod: conditionCount(awaitingPod()),
                    dueDisputed: conditionCount(disputed()),
                    // The dashboard's tile hints: the same scan, one fewer round trip
                    dueProspectSoon: conditionCount(prospectDueSoon(LOADING_WINDOW_DAYS)),
                    dueLoadingOverdue: conditionCount(loadingOverdue()),
                })
                .from(order)
                .where(eq(order.year, year));

            const byStatus = Object.fromEntries(
                ORDER_STATUS.map((status) => [status, row?.[status] ?? 0]),
            ) as Record<OrderStatus, number>;

            const bySection = ORDER_STATUS.reduce(
                (sections, status) => {
                    sections[ORDER_STATUS_SECTION[status]] += byStatus[status];
                    return sections;
                },
                { "prospect": 0, "booked": 0, "on-going": 0, "delivered": 0, "history": 0 } as Record<OrderSection, number>,
            );

            return {
                total: row?.total ?? 0,
                bySection,
                byStatus,
                attention: {
                    loading: row?.dueLoading ?? 0,
                    interrupted: row?.dueInterrupted ?? 0,
                    flagged: row?.dueFlagged ?? 0,
                    pod: row?.duePod ?? 0,
                    disputed: row?.dueDisputed ?? 0,
                },
                pipeline: {
                    prospectsDueSoon: row?.dueProspectSoon ?? 0,
                    loadingOverdue: row?.dueLoadingOverdue ?? 0,
                },
            };
        }),

    /**
     * The year's money still to move, per currency, mirroring the ops
     * cashflow sheet: pending payments per side, payables to carriers,
     * receivables from shippers, insurance Appload has to pay (it comes out
     * of the commission) and cashflow to come. Quotes and lost orders never
     * count; booked trips do unless the caller excludes them.
     */
    cashflow: authorizedProcedure("order", ["list"])
        .input(CashflowInput)
        .query(async ({ ctx, input }): Promise<Cashflow> => {
            const year = input.year ?? thisYear();

            const base = [eq(order.year, year), billable(), input.booked === "exclude" ? ne(order.status, "booked") : undefined];

            const shipperCurrency = currencyOf(order.shipperCurrency);
            const carrierCurrency = currencyOf(order.carrierCurrency);
            const insuranceCurrency = currencyOf(order.insuranceCurrency);

            const [shipper, carrier, insurance] = await Promise.all([
                ctx.db
                    .select({
                        currency: shipperCurrency,
                        pending: count(),
                        amount: outstanding(order.shipperTotal, order.shipperDebitTotal, order.shipperCreditTotal, order.shipperReceivedAmount),
                    })
                    .from(order)
                    .where(and(...base, inArray(order.shipperPaymentStatus, OUTSTANDING_STATUSES)))
                    .groupBy(shipperCurrency),

                ctx.db
                    .select({
                        currency: carrierCurrency,
                        pending: count(),
                        amount: outstanding(order.carrierTotal, order.carrierDebitTotal, order.carrierCreditTotal, order.carrierPaidAmount),
                    })
                    .from(order)
                    .where(and(...base, isNotNull(order.carrierId), inArray(order.carrierPaymentStatus, OUTSTANDING_STATUSES)))
                    .groupBy(carrierCurrency),

                ctx.db
                    .select({
                        currency: insuranceCurrency,
                        amount: sql<number>`coalesce(sum(${order.insuranceValue}), 0)`.mapWith(Number),
                    })
                    .from(order)
                    .where(and(...base, insuranceToPay()))
                    .groupBy(insuranceCurrency),
            ]);

            const lines = new Map<Currency, CashflowLine>();
            const line = (currency: string) => {
                const key = isCurrency(currency) ? currency : "MZN";
                const existing = lines.get(key);
                if (existing) return existing;
                const created = emptyLine(key);
                lines.set(key, created);
                return created;
            };

            for (const row of shipper) {
                const entry = line(row.currency);
                entry.pendingShipper += row.pending;
                entry.receivables = round2(entry.receivables + row.amount);
            }
            for (const row of carrier) {
                const entry = line(row.currency);
                entry.pendingCarrier += row.pending;
                entry.payables = round2(entry.payables + row.amount);
            }
            for (const row of insurance) {
                const entry = line(row.currency);
                entry.insurance = round2(entry.insurance + row.amount);
            }

            return {
                year,
                booked: input.booked,
                // One line per currency in the enum's order, never summed across.
                // A currency only appears once it carries something; a year with
                // no trip pending anywhere leaves the strip empty.
                lines: CURRENCY
                    .flatMap((currency) => {
                        const entry = lines.get(currency);
                        return entry && carries(entry)
                            ? [{ ...entry, cashflow: round2(entry.receivables - entry.payables - entry.insurance) }]
                            : [];
                    }),
            };
        }),

    /** The parties and categories on this year's orders, busiest first — for the search suggestions and the filter menu. */
    filterOptions: authorizedProcedure("order", ["list"])
        .input(YearInput)
        .query(async ({ ctx, input }): Promise<FilterOptions> => {
            const year = eq(order.year, input.year ?? thisYear());

            // The name on the order is the name at the time; the latest one labels the suggestion
            const shipperName = sql<string>`max(${order.shipperName})`;
            const carrierName = sql<string>`max(${order.carrierName})`;

            const [shippers, carriers, categories] = await Promise.all([
                ctx.db
                    .select({ id: order.shipperId, name: shipperName, count: count() })
                    .from(order)
                    .where(year)
                    .groupBy(order.shipperId)
                    .orderBy(desc(count()), asc(shipperName))
                    .limit(250),

                ctx.db
                    .select({ id: order.carrierId, name: carrierName, count: count() })
                    .from(order)
                    .where(and(year, isNotNull(order.carrierId)))
                    .groupBy(order.carrierId)
                    .orderBy(desc(count()), asc(carrierName))
                    .limit(250),

                ctx.db
                    .select({ value: order.category, count: count() })
                    .from(order)
                    .where(year)
                    .groupBy(order.category)
                    .orderBy(desc(count())),
            ]);

            return {
                shippers,
                carriers: carriers.flatMap((row) => (row.id ? [{ id: row.id, name: row.name, count: row.count }] : [])),
                categories,
            };
        }),

    export: authorizedProcedure("order", ["list"])
        .input(OrdersInput.omit({ page: true, pageSize: true }))
        .query(async ({ ctx, input }) => {
            const { items } = await listOrders(ctx.db, input, EXPORT_LIMIT, 0);
            return items;
        }),

    /**
     * Orders needing a hand right now, for the sidebar badges: interrupted
     * or flagged this year, counted per section so the badge sits on the
     * page that can do something about it, and the active disputes (any
     * year) apart, since they have a page of their own.
     */
    attention: authorizedProcedure("order", ["list"])
        .query(async ({ ctx }) => {
            const [rows, [disputes]] = await Promise.all([
                ctx.db
                    .select({ status: order.status, value: count() })
                    .from(order)
                    .where(and(eq(order.year, thisYear()), or(interrupted(), flagged())))
                    .groupBy(order.status),
                ctx.db
                    .select({ value: count() })
                    .from(order)
                    .where(disputed()),
            ]);

            // Statuses fold into the six pages the same way the lists do
            const sections = rows.reduce(
                (totals, row) => {
                    totals[ORDER_STATUS_SECTION[row.status]] += row.value;
                    return totals;
                },
                { "prospect": 0, "booked": 0, "on-going": 0, "delivered": 0, "history": 0 } as Record<OrderSection, number>,
            );

            return { sections, disputes: disputes?.value ?? 0 };
        }),

    /**
     * One status change for several orders, each through the same door as
     * the single one (`transitionOrder`), each with its own optimistic lock.
     * Rows fail alone and the rest go on; the caller gets a verdict per row.
     * The Sheets token is minted once for the batch.
     */
    bulkTransition: authorizedProcedure("order", ["transition"])
        .input(z.object({
            to: z.enum(ORDER_STATUS),
            note: z.string().trim().min(5).max(2000).optional(),
            orders: z.array(z.object({ orderId: z.string(), expectedVersion: z.number().int().min(1) })).min(1).max(50),
        }))
        .mutation(async ({ ctx, input }): Promise<{ results: BulkTransitionResult[] }> => {
            let accessToken: string | null = null;
            try {
                accessToken = await getSheetsAccessToken(ctx.authApi, ctx.headers, ctx.session.user.id);
            } catch (error) {
                // Every row then reports SHEET_FAILED; the outbox cron retries
                console.error("sheet token unavailable for bulk transition", error);
            }

            const results: BulkTransitionResult[] = [];

            // Sequential on purpose: each row derives, syncs and may open a
            // chat; parallel rows would only race on the shared resources
            for (const entry of input.orders) {
                try {
                    const result = await transitionOrder(
                        ctx,
                        { orderId: entry.orderId, to: input.to, expectedVersion: entry.expectedVersion, note: input.note },
                        { accessToken },
                    );
                    results.push({ orderId: entry.orderId, ok: true, ...(result.warning && { warning: result.warning }) });
                } catch (error) {
                    const mapped = toTRPCError(error);
                    results.push({ orderId: entry.orderId, ok: false, code: mapped.message });
                }
            }

            return { results };
        }),

    /**
     * The parties' contact addresses for a batch of orders — what the bulk
     * PDF send prefills. Sync placeholders count as missing.
     */
    partyContacts: authorizedProcedure("order", ["read"])
        .input(z.object({ orderIds: z.array(z.string()).min(1).max(50) }))
        .query(async ({ ctx, input }) => {
            const shipper = alias(organization, "shipper");
            const carrier = alias(organization, "carrier");

            const rows = await ctx.db
                .select({
                    orderId: order.orderId,
                    shipperId: order.shipperId,
                    shipperName: order.shipperName,
                    shipperEmail: shipper.email,
                    carrierId: order.carrierId,
                    carrierName: order.carrierName,
                    carrierEmail: carrier.email,
                })
                .from(order)
                .leftJoin(shipper, eq(shipper.id, order.shipperId))
                .leftJoin(carrier, eq(carrier.id, order.carrierId))
                .where(inArray(order.orderId, input.orderIds));

            const email = (value: string | null) => (value && !isPlaceholder("email", value) ? value : null);

            return rows.map((row) => ({
                orderId: row.orderId,
                shipper: { id: row.shipperId, name: row.shipperName, email: email(row.shipperEmail) },
                carrier: row.carrierId ? { id: row.carrierId, name: row.carrierName ?? "", email: email(row.carrierEmail) } : null,
            }));
        }),

    /** The ⌘K palette: an order by id, party, driver, plate or invoice, any year. */
    search: authorizedProcedure("order", ["list"])
        .input(z.object({ query: z.string().trim().min(1).max(120) }))
        .query(async ({ ctx, input }) => {
            const term = `%${escapeLike(input.query)}%`;

            return ctx.db
                .select({
                    id: order.id,
                    orderId: order.orderId,
                    status: order.status,
                    shipperName: order.shipperName,
                    carrierName: order.carrierName,
                    loadingAddress: order.loadingAddress,
                    offloadingAddress: order.offloadingAddress,
                    expectedLoadingDate: order.expectedLoadingDate,
                })
                .from(order)
                .where(or(
                    ilike(order.orderId, term),
                    ilike(order.shipperName, term),
                    ilike(order.carrierName, term),
                    ilike(order.driverName, term),
                    ilike(order.truckPlate, term),
                    ilike(order.shipperInvoiceNumber, term),
                    ilike(order.carrierInvoiceNumber, term),
                ))
                .orderBy(desc(order.year), desc(order.seq))
                .limit(6);
        }),
});
