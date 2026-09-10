import "server-only";

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, isNotNull, lt, max, or, sql, type SQL } from "drizzle-orm";

import { order } from "@workspace/db/orders";
import { organization } from "@workspace/db/users";
import { partnerConnection } from "@workspace/db/connections";
import { quote } from "@workspace/db/quotes";
import type { db as Database } from "@workspace/db/db";
import type { Address } from "@workspace/db/types";

import { notify } from "@workspace/domain/notifications";
import type { Actor } from "@workspace/domain/orders/actor";
import { createOrder } from "@workspace/domain/orders/create";
import { OrderError } from "@workspace/domain/orders/errors";
import { currentOrderYear, nextOrderId } from "@workspace/domain/orders/order-id";
import { CreateOrderSchemaServer } from "@workspace/domain/orders/schemas";
import type { OrderContext } from "@workspace/domain/orders/transition";

import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedTenantProcedure, tenantProcedure } from "@workspace/trpc/tenant";

import {
    AcceptQuoteBaseSchema,
    CreateQuoteBaseSchema,
    DeclineQuoteBaseSchema,
    WithdrawQuoteBaseSchema,
} from "@/backend/schemas/quote";
import {
    EXPIRING_DAYS,
    PAGE_SIZES,
    QUOTE_SORTS,
    QUOTE_STATUSES,
    type Currency,
    type Location,
    type LoadingBayType,
    type OrgType,
    type PagedResult,
    type QuoteDetail,
    type QuoteRow,
    type QuoteStats,
    type QuoteStatus,
    type RouteType,
    type WeightUnit,
} from "@/frontend/pages/quotes/types";

type Db = typeof Database;

/**
 * The tenant, as every read and write in this feature scopes on it. Taken
 * from the gate (`ctx.tenant`), never from the session's active organization.
 */
type TenantScope = {
    userId: string;
    organizationId: string;
    orgType: OrgType;
};

const scopeOf = (tenant: TenantScope): TenantScope => ({
    userId: tenant.userId,
    organizationId: tenant.organizationId,
    orgType: tenant.orgType,
});

/**
 * A quote means opposite things to the two sides — a carrier writes one, a
 * client answers it — so every mutation names the side it belongs to on top
 * of the role statement its gate already checked.
 */
function assertOrgType(tenant: TenantScope, orgType: OrgType) {
    if (tenant.orgType !== orgType) {
        throw new TRPCError({ code: "FORBIDDEN", message: "WRONG_ORGANIZATION_TYPE" });
    }
}

const actorOf = (tenant: TenantScope): Actor => ({
    kind: "tenant",
    userId: tenant.userId,
    organizationId: tenant.organizationId,
    orgType: tenant.orgType,
});

/**
 * What the shared order door needs from a portal request. `sheets: "defer"`
 * is the portal's whole Sheets story: nothing is pushed here, the outbox row
 * is left pending and Admin's existing sync cron heals the logbook.
 */
const orderContext = (
    ctx: { db: Db; tenant: TenantScope; waitUntil?: (promise: Promise<unknown>) => void },
): OrderContext => ({
    db: ctx.db,
    actor: actorOf(ctx.tenant),
    waitUntil: ctx.waitUntil,
    sheets: "defer",
});

/** The tenant's own company name, as the order row and the notifications carry it. */
async function organizationName(db: Db, organizationId: string): Promise<string> {
    const [row] = await db
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1);

    return row?.name ?? "";
}

/**
 * Domain failures travel as TRPCError with the domain code in `message`, so
 * the client maps them to translated copy (see `domainErrorCode`).
 */
function toTRPCError(error: unknown): TRPCError {
    if (error instanceof TRPCError) return error;

    if (error instanceof OrderError) {
        return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.code, cause: error });
    }

    console.error("unexpected portal quote failure", error);
    return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN", cause: error });
}

// ---------------------------------------------------------------------------
// Scope and projection
// ---------------------------------------------------------------------------

/** Every quote this tenant is a side of, whichever side that is. */
const quoteScope = (tenant: TenantScope): SQL =>
    tenant.orgType === "carrier"
        ? eq(quote.carrierOrgId, tenant.organizationId)
        : eq(quote.clientOrgId, tenant.organizationId);

/** The join that turns a quote row into "the other company". */
const partnerJoin = (tenant: TenantScope): SQL =>
    tenant.orgType === "carrier"
        ? eq(organization.id, quote.clientOrgId)
        : eq(organization.id, quote.carrierOrgId);

const toNumber = (value: string | null): number | null => (value === null ? null : Number(value));

// Escape LIKE wildcards so what the user typed matches literally
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

/** The lane, as text, for the search box: both endpoints of the jsonb columns. */
const laneMatches = (term: string): SQL => {
    const pattern = `%${escapeLike(term)}%`;

    return sql`(
        ${organization.name} ilike ${pattern}
        or ${quote.origin}->>'address' ilike ${pattern}
        or ${quote.destination}->>'address' ilike ${pattern}
    )`;
};

/** The columns a row carries; identical on both sides — a portal quote has no commission. */
const rowColumns = {
    id: quote.id,
    status: quote.status,
    origin: quote.origin,
    destination: quote.destination,
    loadingDate: quote.loadingDate,
    route: quote.route,
    loadingBay: quote.loadingBay,
    capacityWeight: quote.capacityWeight,
    capacityUnit: quote.capacityUnit,
    subtotal: quote.subtotal,
    vat: quote.vat,
    total: quote.total,
    currency: quote.currency,
    includesGit: quote.includesGit,
    includesGps: quote.includesGps,
    validUntil: quote.validUntil,
    createdAt: quote.createdAt,
    partnerId: organization.id,
    partnerName: organization.name,
    partnerAddress: organization.physicalAddress,
    orderRef: order.orderId,
} as const;

/**
 * What `rowColumns` reads back. Spelled out rather than derived from the
 * columns: `orderRef` comes from a LEFT JOIN, so its nullability belongs to
 * the query and not to the column.
 */
type RowProjection = {
    id: string;
    status: QuoteStatus;
    origin: Location;
    destination: Location;
    loadingDate: Date | null;
    route: RouteType;
    loadingBay: LoadingBayType | null;
    capacityWeight: string | null;
    capacityUnit: WeightUnit | null;
    subtotal: string | null;
    vat: string | null;
    total: string;
    currency: Currency;
    includesGit: boolean;
    includesGps: boolean;
    validUntil: Date | null;
    createdAt: Date;
    partnerId: string;
    partnerName: string;
    partnerAddress: Address | null;
    orderRef: string | null;
};

const toRow = (row: RowProjection): QuoteRow => ({
    id: row.id,
    status: row.status,
    partner: {
        id: row.partnerId,
        name: row.partnerName,
        province: row.partnerAddress?.state ?? null,
    },
    origin: row.origin,
    destination: row.destination,
    loadingDate: row.loadingDate,
    route: row.route,
    loadingBay: row.loadingBay,
    capacityWeight: toNumber(row.capacityWeight),
    capacityUnit: row.capacityUnit,
    money: {
        subtotal: toNumber(row.subtotal),
        vat: toNumber(row.vat),
        total: Number(row.total),
        currency: row.currency,
    },
    includesGit: row.includesGit,
    includesGps: row.includesGps,
    validUntil: row.validUntil,
    orderRef: row.orderRef,
    createdAt: row.createdAt,
});

/**
 * Standing quotes whose validity runs out inside the next EXPIRING_DAYS. One
 * definition, so the tile counts exactly the rows its filter opens.
 */
const expiringSoon = (): SQL => {
    const now = new Date();
    const until = new Date(now.getTime() + EXPIRING_DAYS * 24 * 60 * 60 * 1000);

    return and(
        eq(quote.status, "sent"),
        isNotNull(quote.validUntil),
        gte(quote.validUntil, now),
        lt(quote.validUntil, until),
    ) as SQL;
};

/**
 * The connection that lets a carrier quote a client at all. Checked
 * server-side on every write: an organization id typed into a request is
 * never trusted, and a connection that ended closes the door again.
 */
async function assertConnectedClient(db: Db, carrierOrgId: string, clientOrgId: string): Promise<void> {
    const [row] = await db
        .select({ id: partnerConnection.id })
        .from(partnerConnection)
        .where(and(
            eq(partnerConnection.relation, "client-carrier"),
            eq(partnerConnection.status, "accepted"),
            or(
                and(eq(partnerConnection.requesterOrgId, carrierOrgId), eq(partnerConnection.targetOrgId, clientOrgId)),
                and(eq(partnerConnection.targetOrgId, carrierOrgId), eq(partnerConnection.requesterOrgId, clientOrgId)),
            ),
        ))
        .limit(1);

    if (!row) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "CLIENT_NOT_CONNECTED" });
    }
}

export const quotesRouter = createTRPCRouter({
    /**
     * The tenant's own quotes, one page at a time, joined to the other
     * company and to the order an accepted one became.
     *
     * One projection for both sides: a standing quote carries no Appload
     * commission (the portal always prices it at zero), so what the carrier
     * asks is exactly what the client would pay, and there is no leg to hide.
     */
    list: tenantProcedure
        .input(z.object({
            status: z.enum(QUOTE_STATUSES).optional(),
            query: z.string().max(120).optional(),
            expiring: z.literal(true).optional(),
            sort: z.enum(QUOTE_SORTS).default("newest"),
            dir: z.enum(["asc", "desc"]).default("desc"),
            page: z.number().int().positive().default(1),
            pageSize: z.number().int().refine((value) => (PAGE_SIZES as readonly number[]).includes(value)).default(25),
        }))
        .query(async ({ ctx, input }): Promise<PagedResult<QuoteRow>> => {
            const tenant = scopeOf(ctx.tenant);

            const filters: (SQL | undefined)[] = [quoteScope(tenant)];

            if (input.status) filters.push(eq(quote.status, input.status));

            const term = input.query?.trim();
            if (term) filters.push(laneMatches(term));

            if (input.expiring) filters.push(expiringSoon());

            const where = and(...filters);
            const direction = input.dir === "asc" ? asc : desc;

            const orderBy =
                input.sort === "partner" ? direction(organization.name)
                    : input.sort === "total" ? direction(quote.total)
                        : input.sort === "valid" ? direction(quote.validUntil)
                            : direction(quote.createdAt);

            const [rows, [counted]] = await Promise.all([
                ctx.db
                    .select(rowColumns)
                    .from(quote)
                    .innerJoin(organization, partnerJoin(tenant))
                    .leftJoin(order, eq(order.id, quote.orderId))
                    .where(where)
                    .orderBy(orderBy)
                    .limit(input.pageSize)
                    .offset((input.page - 1) * input.pageSize),
                ctx.db
                    .select({ count: sql<number>`count(*)::int` })
                    .from(quote)
                    .innerJoin(organization, partnerJoin(tenant))
                    .where(where),
            ]);

            return {
                items: rows.map(toRow),
                total: counted?.count ?? 0,
                page: input.page,
                pageSize: input.pageSize,
            };
        }),

    /** The three numbers above the table: what stands, what is running out, what landed. */
    stats: tenantProcedure.query(async ({ ctx }): Promise<QuoteStats> => {
        const tenant = scopeOf(ctx.tenant);
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const landedThisMonth = and(eq(quote.status, "accepted"), gte(quote.decidedAt, monthStart));

        const [row] = await ctx.db
            .select({
                total: sql<number>`count(*)::int`,
                sent: sql<number>`count(*) filter (where ${quote.status} = 'sent')::int`,
                accepted: sql<number>`count(*) filter (where ${quote.status} = 'accepted')::int`,
                declined: sql<number>`count(*) filter (where ${quote.status} = 'declined')::int`,
                withdrawn: sql<number>`count(*) filter (where ${quote.status} = 'withdrawn')::int`,
                expired: sql<number>`count(*) filter (where ${quote.status} = 'expired')::int`,
                expiringSoon: sql<number>`count(*) filter (where ${expiringSoon()})::int`,
                acceptedThisMonth: sql<number>`count(*) filter (where ${landedThisMonth})::int`,
            })
            .from(quote)
            .where(quoteScope(tenant));

        return {
            total: row?.total ?? 0,
            byStatus: {
                sent: row?.sent ?? 0,
                accepted: row?.accepted ?? 0,
                declined: row?.declined ?? 0,
                withdrawn: row?.withdrawn ?? 0,
                expired: row?.expired ?? 0,
            },
            expiringSoon: row?.expiringSoon ?? 0,
            acceptedThisMonth: row?.acceptedThisMonth ?? 0,
        };
    }),

    /**
     * One quote in full, with the decisions this tenant may take on it. The
     * panel reads its buttons off `permissions` rather than re-deriving them,
     * so what it offers is exactly what the mutations accept.
     */
    get: tenantProcedure
        .input(z.object({ id: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<QuoteDetail> => {
            const tenant = scopeOf(ctx.tenant);

            const [row] = await ctx.db
                .select({
                    ...rowColumns,
                    fiscalRegime: quote.fiscalRegime,
                    notes: quote.notes,
                    decidedAt: quote.decidedAt,
                    updatedAt: quote.updatedAt,
                })
                .from(quote)
                .innerJoin(organization, partnerJoin(tenant))
                .leftJoin(order, eq(order.id, quote.orderId))
                .where(and(eq(quote.id, input.id), quoteScope(tenant)))
                .limit(1);

            if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

            const standing = row.status === "sent";
            // A price that has run out is still answerable — the client can
            // say no to it — but it can no longer be booked, which is exactly
            // what `accept` refuses
            const lapsed = row.validUntil !== null && row.validUntil.getTime() < Date.now();

            return {
                ...toRow(row),
                fiscalRegime: row.fiscalRegime,
                notes: row.notes,
                decidedAt: row.decidedAt,
                updatedAt: row.updatedAt,
                permissions: {
                    canWithdraw: standing && tenant.orgType === "carrier",
                    canDecline: standing && tenant.orgType === "shipper",
                    canAccept: standing && !lapsed && tenant.orgType === "shipper",
                },
            };
        }),

    /**
     * A carrier offers a lane and a price to one of its connected clients.
     * Nobody asked for it — that is the whole point of a standing quote — so
     * the only door it has to pass is the connection between the two
     * companies, checked here rather than trusted from the payload.
     */
    create: authorizedTenantProcedure("offer", ["create"])
        .input(CreateQuoteBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
            try {
                const tenant = scopeOf(ctx.tenant);
                assertOrgType(tenant, "carrier");

                await assertConnectedClient(ctx.db, tenant.organizationId, input.clientOrgId);

                const [created] = await ctx.db
                    .insert(quote)
                    .values({
                        carrierOrgId: tenant.organizationId,
                        clientOrgId: input.clientOrgId,
                        origin: input.origin,
                        destination: input.destination,
                        loadingDate: input.loadingDate ?? null,
                        route: input.route,
                        loadingBay: input.loadingBay ?? null,
                        capacityWeight: input.capacityWeight === undefined ? null : String(input.capacityWeight),
                        capacityUnit: input.capacityUnit ?? null,
                        fiscalRegime: input.fiscalRegime,
                        subtotal: input.subtotal === undefined ? null : String(input.subtotal),
                        vat: input.vat === undefined ? null : String(input.vat),
                        total: String(input.total),
                        currency: input.currency,
                        includesGit: input.includesGit,
                        includesGps: input.includesGps,
                        notes: input.notes?.trim() || null,
                        validUntil: input.validUntil ?? null,
                        status: "sent",
                        createdBy: tenant.userId,
                    })
                    .returning({ id: quote.id });

                if (!created) {
                    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
                }

                const carrierName = await organizationName(ctx.db, tenant.organizationId);

                await notify(ctx.db, {
                    organizationId: input.clientOrgId,
                    kind: "quote.received",
                    email: true,
                    entityType: "quote",
                    entityId: created.id,
                    params: { carrierName },
                });

                return { id: created.id };
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /**
     * The carrier takes back a quote nobody answered. Kept as "withdrawn"
     * rather than deleted: the client may already have read it, and the row
     * is the record of what was offered.
     */
    withdraw: authorizedTenantProcedure("offer", ["update"])
        .input(WithdrawQuoteBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
            try {
                const tenant = scopeOf(ctx.tenant);
                assertOrgType(tenant, "carrier");

                const row = await loadOwnQuote(ctx.db, input.id, tenant);

                const [updated] = await ctx.db
                    .update(quote)
                    .set({ status: "withdrawn", decidedBy: tenant.userId, decidedAt: new Date() })
                    // Compare-and-set on the status: a second click on a stale
                    // panel finds nothing to change rather than reopening a
                    // decision the client already made
                    .where(and(eq(quote.id, row.id), eq(quote.carrierOrgId, tenant.organizationId), eq(quote.status, "sent")))
                    .returning({ id: quote.id });

                if (!updated) {
                    throw new TRPCError({ code: "CONFLICT", message: "QUOTE_NOT_SENT" });
                }

                const carrierName = await organizationName(ctx.db, tenant.organizationId);

                await notify(ctx.db, {
                    organizationId: row.clientOrgId,
                    kind: "quote.withdrawn",
                    // A price that is no longer on the table is read in the
                    // portal when the client next looks at it
                    email: false,
                    entityType: "quote",
                    entityId: row.id,
                    params: { carrierName },
                });

                return { id: row.id };
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /**
     * The client turns a quote down. The note is the carrier's answer to
     * "why not" — it travels with the notification; the quote table has no
     * column for a decision note, and the row keeps only the decision.
     */
    decline: authorizedTenantProcedure("offer", ["update"])
        .input(DeclineQuoteBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
            try {
                const tenant = scopeOf(ctx.tenant);
                assertOrgType(tenant, "shipper");

                const row = await loadOwnQuote(ctx.db, input.id, tenant);

                const [updated] = await ctx.db
                    .update(quote)
                    .set({ status: "declined", decidedBy: tenant.userId, decidedAt: new Date() })
                    .where(and(eq(quote.id, row.id), eq(quote.clientOrgId, tenant.organizationId), eq(quote.status, "sent")))
                    .returning({ id: quote.id });

                if (!updated) {
                    throw new TRPCError({ code: "CONFLICT", message: "QUOTE_NOT_SENT" });
                }

                const clientName = await organizationName(ctx.db, tenant.organizationId);
                const note = input.note?.trim() || null;

                await notify(ctx.db, {
                    organizationId: row.carrierOrgId,
                    kind: "quote.declined",
                    email: false,
                    entityType: "quote",
                    entityId: row.id,
                    params: { clientName, note },
                });

                return { id: row.id };
            } catch (error) {
                throw toTRPCError(error);
            }
        }),

    /**
     * The client accepts a standing quote, which is what turns it into an
     * order: the lane, the carrier and the price come from the quote, and the
     * cargo is what this payload adds.
     *
     * The order is created BOOKED with the quote's carrier as its accepted
     * offer, through the same shared door Admin books with — so a quote-born
     * order carries the same history row, the same offer trail and the same
     * pending Sheets sync as any other.
     *
     * Ordering (neon-http has no transactions): the quote is claimed FIRST,
     * with `status = 'sent'` as the compare-and-set predicate. Two clicks
     * therefore produce one order, not two — and if the create then fails,
     * the claim is rolled back so the quote can be accepted again.
     *
     * Free of the plan gate on purpose (§5): quoting is the paid move, saying
     * yes to one is not — a client on the free plan that is sent a quote must
     * be able to accept it, which is also what the sheet's Accept button
     * offers it unconditionally.
     */
    accept: authorizedTenantProcedure("order", ["create"])
        .input(AcceptQuoteBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ orderId: string }> => {
            const tenant = scopeOf(ctx.tenant);

            assertOrgType(tenant, "shipper");

            const row = await loadOwnQuote(ctx.db, input.id, tenant);

            if (row.validUntil !== null && row.validUntil.getTime() < Date.now()) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "QUOTE_EXPIRED" });
            }

            // A quote may carry no loading date at all — it is a standing
            // price, not a booking — so the cargo form supplies one. The
            // quote's own date is the default the form seeds itself with.
            const expectedLoadingDate = input.cargo.expectedLoadingDate ?? row.loadingDate;

            if (!expectedLoadingDate) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "LOADING_DATE_REQUIRED" });
            }

            const [claimed] = await ctx.db
                .update(quote)
                .set({ status: "accepted", decidedBy: tenant.userId, decidedAt: new Date() })
                .where(and(eq(quote.id, row.id), eq(quote.clientOrgId, tenant.organizationId), eq(quote.status, "sent")))
                .returning({ id: quote.id });

            if (!claimed) {
                throw new TRPCError({ code: "CONFLICT", message: "ALREADY_DECIDED" });
            }

            // Compensation for everything below: the claim is the only write
            // so far, so putting it back leaves the quote exactly as it was
            const release = async () => {
                await ctx.db
                    .update(quote)
                    .set({ status: "sent", decidedBy: null, decidedAt: null })
                    .where(and(eq(quote.id, row.id), eq(quote.status, "accepted")))
                    .catch(() => undefined);
            };

            try {
                const [clientName, carrierName] = await Promise.all([
                    organizationName(ctx.db, tenant.organizationId),
                    organizationName(ctx.db, row.carrierOrgId),
                ]);

                const year = currentOrderYear();

                const payload = CreateOrderSchemaServer.parse({
                    shipperId: tenant.organizationId,
                    shipperName: clientName,
                    status: "booked",

                    loadingAddress: row.origin,
                    expectedLoadingDate,
                    offloadingAddress: row.destination,
                    expectedOffloadingDate: input.cargo.expectedOffloadingDate,
                    distance: input.cargo.distance,
                    deliveries: input.cargo.deliveries,
                    routeType: row.route,
                    tripType: "normal",

                    category: input.cargo.category,
                    description: input.cargo.description,
                    weight: input.cargo.weight,
                    weightUnit: input.cargo.weightUnit,
                    loadType: input.cargo.loadType,

                    shipperCurrency: row.currency,

                    // The quote IS the offer: one carrier, already accepted,
                    // at the price the client said yes to
                    offers: [{
                        carrierId: row.carrierOrgId,
                        carrierName,
                        fiscalRegime: row.fiscalRegime,
                        subtotal: toNumber(row.subtotal) ?? undefined,
                        vat: toNumber(row.vat) ?? undefined,
                        total: Number(row.total),
                        currency: row.currency,
                        commissionTotal: 0,
                        includesGit: row.includesGit,
                        includesGps: row.includesGps,
                        notes: row.notes ?? undefined,
                        accepted: true,
                    }],
                });

                // Appload takes nothing on a portal booking until staff price
                // it in Admin. The create schema still derives a commission
                // split from the accepted offer (`priceOffer`), which for a
                // simplified-regime carrier on a national route lands the
                // client's own VAT on the commission line — so the three
                // commission fields are pinned to zero here, which is also
                // what `guardCreateForActor` requires of a tenant payload.
                const booked = {
                    ...payload,
                    commissionSubtotal: 0,
                    commissionVAT: 0,
                    commissionTotal: 0,
                };

                const result = await createOrder(
                    orderContext({ db: ctx.db, tenant }),
                    booked,
                    {
                        // The unique (year, seq) index arbitrates concurrent
                        // creates, so every attempt recomputes the sequence.
                        // The portal has no logbook to read: the sheet's own
                        // max is 0 and Admin's sync cron heals the sheet.
                        nextOrderId: async () => {
                            const [seq] = await ctx.db
                                .select({ value: max(order.seq) })
                                .from(order)
                                .where(eq(order.year, year));

                            return nextOrderId(seq?.value ?? 0, 0, year);
                        },
                    },
                );

                // The quote now points at what it became, and the order says
                // where it came from. Neither is fatal: the order exists, the
                // quote is decided, and a failure here only costs the link.
                await Promise.all([
                    ctx.db
                        .update(quote)
                        .set({ orderId: result.order.id })
                        .where(eq(quote.id, row.id))
                        .catch((error) => console.error(`quote ${row.id} order link failed`, error)),
                    ctx.db
                        .update(order)
                        .set({
                            source: "carrier",
                            ...(input.cargo.packing !== undefined && { packing: input.cargo.packing }),
                            ...(input.cargo.expectedTrucks !== undefined && { expectedTrucks: input.cargo.expectedTrucks }),
                            ...(input.cargo.isHazardous && { isHazardous: true }),
                            ...(input.cargo.hazchemCode !== undefined && { hazchemCode: input.cargo.hazchemCode }),
                            ...(input.cargo.isRefrigerated && { isRefrigerated: true }),
                            ...(input.cargo.temperature !== undefined && { temperature: String(input.cargo.temperature) }),
                            ...(input.cargo.temperatureInstructions !== undefined && {
                                temperatureInstructions: input.cargo.temperatureInstructions,
                            }),
                        })
                        .where(eq(order.id, result.order.id))
                        .catch((error) => console.error(`order details failed for ${result.orderId}`, error)),
                ]);

                await notify(ctx.db, {
                    organizationId: row.carrierOrgId,
                    kind: "quote.accepted",
                    email: true,
                    entityType: "order",
                    entityId: result.orderId,
                    params: { orderId: result.orderId, clientName },
                });

                return { orderId: result.orderId };
            } catch (error) {
                await release();
                throw toTRPCError(error);
            }
        }),
});

/**
 * One quote of this tenant's, whichever side it is on. Every mutation loads
 * the row through here first: the id from the input only ever combines with
 * the tenant predicate, so an id from another company reads as missing.
 */
async function loadOwnQuote(db: Db, id: string, tenant: TenantScope) {
    const [row] = await db
        .select({
            id: quote.id,
            status: quote.status,
            carrierOrgId: quote.carrierOrgId,
            clientOrgId: quote.clientOrgId,
            origin: quote.origin,
            destination: quote.destination,
            loadingDate: quote.loadingDate,
            route: quote.route,
            fiscalRegime: quote.fiscalRegime,
            subtotal: quote.subtotal,
            vat: quote.vat,
            total: quote.total,
            currency: quote.currency,
            includesGit: quote.includesGit,
            includesGps: quote.includesGps,
            notes: quote.notes,
            validUntil: quote.validUntil,
        })
        .from(quote)
        .where(and(eq(quote.id, id), quoteScope(tenant)))
        .limit(1);

    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

    if (row.status !== "sent") {
        throw new TRPCError({ code: "CONFLICT", message: "QUOTE_NOT_SENT" });
    }

    return row;
}
