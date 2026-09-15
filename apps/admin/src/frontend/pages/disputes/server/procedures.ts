import { z } from "zod";
import { and, count, desc, eq, ilike, inArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { order, orderDispute, orderHistory } from "@workspace/db/orders";
import { user } from "@workspace/db/users";
import { ACTIVE_DISPUTE_STATUSES, CURRENCY, DISPUTE_LIABLE_PARTY, DISPUTE_REASON, DISPUTE_STATUS, isActiveDispute } from "@workspace/db/types";
import type { DisputeStatus } from "@workspace/db/types";
import type { db as Database } from "@workspace/db/db";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";

import { uniqueViolationConstraint } from "@workspace/db/errors";
import { UNBILLABLE_STATUSES } from "@/frontend/pages/orders/types";
import { DISPUTE_SORTS, HOLD_SIDES, type DisputeRow, type DisputeStats, type PagedResult } from "@/frontend/pages/disputes/types";

const EXPORT_LIMIT = 2000;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const ListInput = z.object({
    search: z.string().trim().max(120).optional(),
    status: z.enum(DISPUTE_STATUS).optional(),
    reason: z.enum(DISPUTE_REASON).optional(),
    liable: z.enum(DISPUTE_LIABLE_PARTY).optional(),
    hold: z.enum(HOLD_SIDES).optional(),
    sort: z.enum(DISPUTE_SORTS).optional(),
    dir: z.enum(["asc", "desc"]).default("desc"),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).default(25),
});

type ListInput = z.infer<typeof ListInput>;

const Money = z.number().min(0).max(1_000_000_000);

const OpenInput = z.object({
    orderId: z.string(),
    reason: z.enum(DISPUTE_REASON),
    description: z.string().trim().min(10).max(4000),
    claimedAmount: Money.optional(),
    claimedCurrency: z.enum(CURRENCY).optional(),
    liableParty: z.enum(DISPUTE_LIABLE_PARTY).optional(),
    holdShipperPayments: z.boolean().default(true),
    holdCarrierPayments: z.boolean().default(true),
});

const UpdateInput = z.object({
    id: z.string(),
    expectedVersion: z.number().int().min(1),
    patch: z.object({
        description: z.string().trim().min(10).max(4000).optional(),
        claimedAmount: Money.nullable().optional(),
        claimedCurrency: z.enum(CURRENCY).nullable().optional(),
        liableParty: z.enum(DISPUTE_LIABLE_PARTY).nullable().optional(),
        holdShipperPayments: z.boolean().optional(),
        holdCarrierPayments: z.boolean().optional(),
        status: z.enum(["open", "under-review"]).optional(),
    }),
});

const ResolveInput = z.object({
    id: z.string(),
    expectedVersion: z.number().int().min(1),
    status: z.enum(["settled", "closed"]),
    resolution: z.string().trim().min(5).max(4000),
});

const decimal = (value: number | null | undefined) => (value === null || value === undefined ? null : String(value));

const STATUS_POSITION = sql`array_position(ARRAY[${sql.join(DISPUTE_STATUS.map((status) => sql`${status}`), sql`, `)}]::text[], ${orderDispute.status})`;

const ROW = {
    id: orderDispute.id,
    orderId: order.orderId,
    orderStatus: order.status,
    reason: orderDispute.reason,
    status: orderDispute.status,
    description: orderDispute.description,
    claimedAmount: orderDispute.claimedAmount,
    claimedCurrency: orderDispute.claimedCurrency,
    liableParty: orderDispute.liableParty,
    holdShipperPayments: orderDispute.holdShipperPayments,
    holdCarrierPayments: orderDispute.holdCarrierPayments,
    openedAt: orderDispute.openedAt,
    openedByName: user.name,
    resolvedAt: orderDispute.resolvedAt,
    shipperName: order.shipperName,
    carrierName: order.carrierName,
    version: orderDispute.version,
    updatedAt: orderDispute.updatedAt,
} satisfies Record<keyof DisputeRow, AnyColumn>;

function scope(input: Omit<ListInput, "sort" | "dir" | "page" | "pageSize">): SQL | undefined {
    const conditions: (SQL | undefined)[] = [];

    if (input.status) conditions.push(eq(orderDispute.status, input.status));
    if (input.reason) conditions.push(eq(orderDispute.reason, input.reason));
    if (input.liable) conditions.push(eq(orderDispute.liableParty, input.liable));
    if (input.hold === "shipper") conditions.push(eq(orderDispute.holdShipperPayments, true));
    if (input.hold === "carrier") conditions.push(eq(orderDispute.holdCarrierPayments, true));

    if (input.search) {
        const term = `%${escapeLike(input.search)}%`;
        conditions.push(or(
            ilike(order.orderId, term),
            ilike(order.shipperName, term),
            ilike(order.carrierName, term),
            ilike(orderDispute.description, term),
        ));
    }

    return conditions.length ? and(...conditions) : undefined;
}

function ordering(sort: ListInput["sort"], dir: ListInput["dir"]): SQL[] {
    const by = (column: AnyColumn | SQL) => (dir === "desc" ? sql`${column} desc nulls last` : sql`${column} asc nulls last`);
    const newest = desc(orderDispute.openedAt);

    switch (sort) {
        case "claimed": return [by(orderDispute.claimedAmount), newest];
        case "status": return [by(STATUS_POSITION), newest];
        case "updated": return [by(orderDispute.updatedAt), newest];
        default: return [by(orderDispute.openedAt)];
    }
}

/** A dispute's own trail: the `dispute` history rows of its order, newest first. */
const historyOf = (db: typeof Database, orderPk: string, disputeId: string) =>
    db
        .select({
            id: orderHistory.id,
            metadata: orderHistory.metadata,
            createdAt: orderHistory.createdAt,
            actorName: user.name,
        })
        .from(orderHistory)
        .leftJoin(user, eq(orderHistory.actorUserId, user.id))
        .where(and(eq(orderHistory.orderId, orderPk), eq(orderHistory.kind, "dispute"), sql`${orderHistory.metadata}->>'disputeId' = ${disputeId}`))
        .orderBy(desc(orderHistory.createdAt));

export const disputesRouter = createTRPCRouter({
    list: authorizedProcedure("dispute", ["list"])
        .input(ListInput)
        .query(async ({ ctx, input }): Promise<PagedResult<DisputeRow>> => {
            const page = input.page ?? 1;
            const offset = (page - 1) * input.pageSize;
            const where = scope(input);

            const [items, [total]] = await Promise.all([
                ctx.db
                    .select(ROW)
                    .from(orderDispute)
                    .innerJoin(order, eq(order.id, orderDispute.orderId))
                    .leftJoin(user, eq(user.id, orderDispute.openedBy))
                    .where(where)
                    .orderBy(...ordering(input.sort, input.dir))
                    .limit(input.pageSize)
                    .offset(offset),
                ctx.db
                    .select({ value: count() })
                    .from(orderDispute)
                    .innerJoin(order, eq(order.id, orderDispute.orderId))
                    .where(where),
            ]);

            const totalCount = total?.value ?? 0;

            return {
                items: items as DisputeRow[],
                total: totalCount,
                page,
                pageSize: input.pageSize,
            };
        }),

    export: authorizedProcedure("dispute", ["list"])
        .input(ListInput.omit({ page: true, pageSize: true }))
        .query(async ({ ctx, input }) => {
            const rows = await ctx.db
                .select(ROW)
                .from(orderDispute)
                .innerJoin(order, eq(order.id, orderDispute.orderId))
                .leftJoin(user, eq(user.id, orderDispute.openedBy))
                .where(scope(input))
                .orderBy(...ordering(input.sort, input.dir))
                .limit(EXPORT_LIMIT);

            return rows as DisputeRow[];
        }),

    /** Counts by status for the tabs and the claimed money on active disputes. */
    stats: authorizedProcedure("dispute", ["list"])
        .query(async ({ ctx }): Promise<DisputeStats> => {
            const byStatusSelect = Object.fromEntries(
                DISPUTE_STATUS.map((status) => [status, sql<number>`count(*) filter (where ${orderDispute.status} = ${status})`.mapWith(Number)]),
            ) as Record<DisputeStatus, SQL<number>>;

            const currency = sql<string>`coalesce(${orderDispute.claimedCurrency}::text, 'MZN')`;

            const [[row], claimed] = await Promise.all([
                ctx.db.select({ ...byStatusSelect, total: count() }).from(orderDispute),
                ctx.db
                    .select({
                        currency,
                        amount: sql<number>`coalesce(sum(${orderDispute.claimedAmount}), 0)`.mapWith(Number),
                        count: count(),
                    })
                    .from(orderDispute)
                    .where(and(inArray(orderDispute.status, [...ACTIVE_DISPUTE_STATUSES]), sql`${orderDispute.claimedAmount} is not null`))
                    .groupBy(currency),
            ]);

            return {
                total: row?.total ?? 0,
                byStatus: Object.fromEntries(DISPUTE_STATUS.map((status) => [status, row?.[status] ?? 0])) as Record<DisputeStatus, number>,
                claimed,
            };
        }),

    get: authorizedProcedure("dispute", ["read"])
        .input(z.object({ id: z.string() }))
        .query(async ({ ctx, input }) => {
            const [row] = await ctx.db
                .select({
                    dispute: orderDispute,
                    order: {
                        id: order.id,
                        orderId: order.orderId,
                        status: order.status,
                        shipperName: order.shipperName,
                        carrierName: order.carrierName,
                        shipperCurrency: order.shipperCurrency,
                        carrierCurrency: order.carrierCurrency,
                        shipperTotal: order.shipperTotal,
                        carrierTotal: order.carrierTotal,
                        expectedLoadingDate: order.expectedLoadingDate,
                        loadingAddress: order.loadingAddress,
                        offloadingAddress: order.offloadingAddress,
                    },
                    openedByName: user.name,
                })
                .from(orderDispute)
                .innerJoin(order, eq(order.id, orderDispute.orderId))
                .leftJoin(user, eq(user.id, orderDispute.openedBy))
                .where(eq(orderDispute.id, input.id));

            if (!row) {
                throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
            }

            const history = await historyOf(ctx.db, row.order.id, row.dispute.id);

            return { ...row, history };
        }),

    /**
     * Opens a dispute on an order: one active dispute at a time, never on a
     * quote or a lost order. The order's mirror column and a history row
     * are written in the same batch, so the three can never disagree.
     */
    open: authorizedProcedure("dispute", ["open"])
        .input(OpenInput)
        .mutation(async ({ ctx, input }) => {
            const [current] = await ctx.db
                .select({ id: order.id, status: order.status, disputeStatus: order.disputeStatus })
                .from(order)
                .where(eq(order.orderId, input.orderId));

            if (!current) {
                throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
            }
            if (UNBILLABLE_STATUSES.includes(current.status)) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "DISPUTE_INVALID_ORDER" });
            }
            if (isActiveDispute(current.disputeStatus)) {
                throw new TRPCError({ code: "CONFLICT", message: "DISPUTE_EXISTS" });
            }

            const id = crypto.randomUUID();

            try {
                await ctx.db.batch([
                    ctx.db.insert(orderDispute).values({
                        id,
                        orderId: current.id,
                        reason: input.reason,
                        status: "open",
                        description: input.description,
                        claimedAmount: decimal(input.claimedAmount),
                        claimedCurrency: input.claimedCurrency ?? null,
                        liableParty: input.liableParty ?? null,
                        holdShipperPayments: input.holdShipperPayments,
                        holdCarrierPayments: input.holdCarrierPayments,
                        openedBy: ctx.session.user.id,
                    }),
                    ctx.db.update(order).set({ disputeStatus: "open" }).where(eq(order.id, current.id)),
                    ctx.db.insert(orderHistory).values({
                        orderId: current.id,
                        actorUserId: ctx.session.user.id,
                        kind: "dispute",
                        metadata: {
                            disputeId: id,
                            action: "opened",
                            reason: input.reason,
                            status: "open",
                            holdShipperPayments: input.holdShipperPayments,
                            holdCarrierPayments: input.holdCarrierPayments,
                        },
                    }),
                ]);
            } catch (error) {
                // The partial unique index catches a concurrent open
                if (uniqueViolationConstraint(error) !== null) {
                    throw new TRPCError({ code: "CONFLICT", message: "DISPUTE_EXISTS" });
                }
                throw error;
            }

            return { id, orderId: input.orderId };
        }),

    update: authorizedProcedure("dispute", ["update"])
        .input(UpdateInput)
        .mutation(async ({ ctx, input }) => {
            const [current] = await ctx.db
                .select({ id: orderDispute.id, orderId: orderDispute.orderId, status: orderDispute.status, humanId: order.orderId })
                .from(orderDispute)
                .innerJoin(order, eq(order.id, orderDispute.orderId))
                .where(eq(orderDispute.id, input.id));

            if (!current) {
                throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
            }
            if (!isActiveDispute(current.status)) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "DISPUTE_CLOSED" });
            }

            const { patch } = input;
            const changedFields = Object.keys(patch).filter((key) => patch[key as keyof typeof patch] !== undefined);

            const [updated] = await ctx.db
                .update(orderDispute)
                .set({
                    ...(patch.description !== undefined && { description: patch.description }),
                    ...(patch.claimedAmount !== undefined && { claimedAmount: decimal(patch.claimedAmount) }),
                    ...(patch.claimedCurrency !== undefined && { claimedCurrency: patch.claimedCurrency }),
                    ...(patch.liableParty !== undefined && { liableParty: patch.liableParty }),
                    ...(patch.holdShipperPayments !== undefined && { holdShipperPayments: patch.holdShipperPayments }),
                    ...(patch.holdCarrierPayments !== undefined && { holdCarrierPayments: patch.holdCarrierPayments }),
                    ...(patch.status !== undefined && { status: patch.status }),
                    version: sql`${orderDispute.version} + 1`,
                })
                .where(and(eq(orderDispute.id, input.id), eq(orderDispute.version, input.expectedVersion)))
                .returning();

            if (!updated) {
                throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
            }

            await ctx.db.batch([
                ctx.db.update(order).set({ disputeStatus: updated.status }).where(eq(order.id, current.orderId)),
                ctx.db.insert(orderHistory).values({
                    orderId: current.orderId,
                    actorUserId: ctx.session.user.id,
                    kind: "dispute",
                    metadata: {
                        disputeId: updated.id,
                        action: "updated",
                        reason: updated.reason,
                        status: updated.status,
                        holdShipperPayments: updated.holdShipperPayments,
                        holdCarrierPayments: updated.holdCarrierPayments,
                        changedFields,
                    },
                }),
            ]);

            return { id: updated.id, orderId: current.humanId, dispute: updated };
        }),

    /** Settles or closes a dispute: lifts the holds and lets the order complete. Supervisory. */
    resolve: authorizedProcedure("dispute", ["resolve"])
        .input(ResolveInput)
        .mutation(async ({ ctx, input }) => {
            const [current] = await ctx.db
                .select({ id: orderDispute.id, orderId: orderDispute.orderId, status: orderDispute.status, humanId: order.orderId })
                .from(orderDispute)
                .innerJoin(order, eq(order.id, orderDispute.orderId))
                .where(eq(orderDispute.id, input.id));

            if (!current) {
                throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
            }
            if (!isActiveDispute(current.status)) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "DISPUTE_CLOSED" });
            }

            const [updated] = await ctx.db
                .update(orderDispute)
                .set({
                    status: input.status,
                    resolution: input.resolution,
                    resolvedBy: ctx.session.user.id,
                    resolvedAt: new Date(),
                    version: sql`${orderDispute.version} + 1`,
                })
                .where(and(eq(orderDispute.id, input.id), eq(orderDispute.version, input.expectedVersion)))
                .returning();

            if (!updated) {
                throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
            }

            await ctx.db.batch([
                // Settled or closed, the order is free again
                ctx.db.update(order).set({ disputeStatus: null }).where(eq(order.id, current.orderId)),
                ctx.db.insert(orderHistory).values({
                    orderId: current.orderId,
                    actorUserId: ctx.session.user.id,
                    kind: "dispute",
                    metadata: {
                        disputeId: updated.id,
                        action: "resolved",
                        reason: updated.reason,
                        status: updated.status,
                        resolution: input.resolution,
                    },
                }),
            ]);

            return { id: updated.id, orderId: current.humanId, dispute: updated };
        }),

    /** Active disputes, for the sidebar badge. */
    attention: authorizedProcedure("dispute", ["list"])
        .query(async ({ ctx }) => {
            const [row] = await ctx.db
                .select({ value: count() })
                .from(orderDispute)
                .where(inArray(orderDispute.status, [...ACTIVE_DISPUTE_STATUSES]));

            return row?.value ?? 0;
        }),
});
