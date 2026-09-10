import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, ilike, ne, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import { order } from "@workspace/db/orders";
import { organization } from "@workspace/db/users";
import type { db as Database } from "@workspace/db/db";
import { AddressSchema, type Address } from "@workspace/db/types";
import { CONNECTION_RELATION, CONNECTION_STATUS, partnerConnection, type ConnectionRelation, type ConnectionStatus } from "@workspace/db/connections";

import { notify } from "@workspace/domain/notifications";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedTenantProcedure, tenantProcedure } from "@workspace/trpc/tenant";

import { uniqueViolationConstraint } from "@workspace/db/errors";
import { withinRateLimit } from "@/lib/rate-limit";
import { ConnectionRequestBaseSchema, NUIT_RE, RegisterPartnerBaseSchema } from "@/backend/schemas/partner";
import {
    counterpartType,
    CONNECTION_DIRECTIONS,
    PAGE_SIZES,
    PARTNER_SORTS,
    SEARCH_MIN_CHARS,
    type ConnectionDirection,
    type OrgType,
    type PagedResult,
    type PartnerCandidate,
    type PartnerProfile,
    type PartnerRow,
    type PartnerStats,
    type SharedOrders,
} from "@/frontend/pages/partners/types";

// Escape LIKE wildcards so what the user typed matches literally
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const slugify = (name: string) =>
    name
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

/**
 * A blank or half-filled address block is stored as null rather than as an
 * address the maps and PDFs could not use.
 */
function toAddress(value: Partial<Address> | undefined): Address | null {
    const parsed = AddressSchema.safeParse(value);

    return parsed.success ? parsed.data : null;
}

/**
 * The relation a tenant may ask for. A shipper never subcontracts: the
 * relation exists for a carrier hiring another carrier, and the requester is
 * the contractor.
 */
function assertRelationAllowed(orgType: OrgType, relation: ConnectionRelation) {
    if (relation === "subcontract" && orgType !== "carrier") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "RELATION_NOT_ALLOWED" });
    }
}

/**
 * The pair row for this tenant and one counterpart, whichever way it points.
 * `partnerId` is a value when the counterpart is known and a column when the
 * lookups join the pair onto every candidate row.
 */
const pairFilter = (tenantId: string, partnerId: string | SQLWrapper) =>
    or(
        and(eq(partnerConnection.requesterOrgId, tenantId), eq(partnerConnection.targetOrgId, partnerId)),
        and(eq(partnerConnection.targetOrgId, tenantId), eq(partnerConnection.requesterOrgId, partnerId)),
    );

/** Every connection this tenant is a side of. */
const tenantSideFilter = (tenantId: string) =>
    or(eq(partnerConnection.requesterOrgId, tenantId), eq(partnerConnection.targetOrgId, tenantId));

/**
 * The join that turns a connection row into "the other company": whichever
 * of the two organization ids is not the tenant's own.
 */
const partnerJoin = (tenantId: string) =>
    or(
        and(eq(partnerConnection.requesterOrgId, tenantId), eq(organization.id, partnerConnection.targetOrgId)),
        and(eq(partnerConnection.targetOrgId, tenantId), eq(organization.id, partnerConnection.requesterOrgId)),
    );

/**
 * Orders the two companies ran together, either way round — the one number
 * that says whether a connection is a working relationship or a formality.
 * Correlated on the connection row, so it needs no tenant predicate of its
 * own.
 */
const sharedOrdersExpr = sql<number>`(
    select count(*)::int from ${order}
    where (${order.shipperId} = ${partnerConnection.requesterOrgId} and ${order.carrierId} = ${partnerConnection.targetOrgId})
       or (${order.shipperId} = ${partnerConnection.targetOrgId} and ${order.carrierId} = ${partnerConnection.requesterOrgId})
)`;

const sinceExpr = sql`coalesce(${partnerConnection.respondedAt}, ${partnerConnection.createdAt})`;

export const partnersRouter = createTRPCRouter({
    /**
     * Type-to-search over the companies this tenant could connect to. The
     * projection is deliberately narrow — name, province and verification —
     * because a company the caller has no connection to owes them no contact
     * details. The pair's own connection travels with each row so the UI can
     * say "already connected" instead of offering a request that would fail.
     */
    search: tenantProcedure
        .input(z.object({
            query: z.string(),
            relation: z.enum(CONNECTION_RELATION),
        }))
        .query(async ({ ctx, input }): Promise<PartnerCandidate[]> => {
            const tenantId = ctx.tenant.organizationId;
            const term = input.query.trim();

            assertRelationAllowed(ctx.tenant.orgType, input.relation);

            if (term.length < SEARCH_MIN_CHARS) return [];

            const rows = await ctx.db
                .select({
                    id: organization.id,
                    name: organization.name,
                    type: organization.type,
                    physicalAddress: organization.physicalAddress,
                    kycStatus: organization.kycStatus,
                    connectionId: partnerConnection.id,
                    connectionStatus: partnerConnection.status,
                    requesterOrgId: partnerConnection.requesterOrgId,
                })
                .from(organization)
                .leftJoin(partnerConnection, pairFilter(tenantId, organization.id))
                .where(and(
                    eq(organization.type, counterpartType(ctx.tenant.orgType, input.relation)),
                    ne(organization.id, tenantId),
                    ne(organization.status, "closed"),
                    ilike(organization.name, `%${escapeLike(term)}%`),
                ))
                .orderBy(asc(organization.name))
                .limit(10);

            return rows.map((row) => toCandidate(row, tenantId));
        }),

    /**
     * The exact-NUIT door into the same projection. Every company Appload
     * loaded from the logbook is already in the database, so a partner that
     * name search missed is usually one keystroke away by its tax number.
     */
    lookupNuit: tenantProcedure
        .input(z.object({ nuit: z.string().regex(NUIT_RE) }))
        .query(async ({ ctx, input }): Promise<PartnerCandidate | null> => {
            const tenantId = ctx.tenant.organizationId;

            const [row] = await ctx.db
                .select({
                    id: organization.id,
                    name: organization.name,
                    type: organization.type,
                    physicalAddress: organization.physicalAddress,
                    kycStatus: organization.kycStatus,
                    connectionId: partnerConnection.id,
                    connectionStatus: partnerConnection.status,
                    requesterOrgId: partnerConnection.requesterOrgId,
                })
                .from(organization)
                .leftJoin(partnerConnection, pairFilter(tenantId, organization.id))
                .where(and(
                    eq(organization.nuit, input.nuit),
                    ne(organization.id, tenantId),
                    ne(organization.status, "closed"),
                ))
                .limit(1);

            return row ? toCandidate(row, tenantId) : null;
        }),

    /**
     * Asks a company to work with this one. One row per pair whichever side
     * asked (the unique index sorts the two ids), so a request that follows a
     * declined or removed one reopens the same row rather than adding a
     * second.
     */
    request: authorizedTenantProcedure("partner", ["request"])
        .input(ConnectionRequestBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
            const tenantId = ctx.tenant.organizationId;

            assertRelationAllowed(ctx.tenant.orgType, input.relation);

            if (input.organizationId === tenantId) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "SELF_CONNECTION" });
            }

            const [target, self] = await Promise.all([
                ctx.db
                    .select({ id: organization.id, type: organization.type, status: organization.status })
                    .from(organization)
                    .where(eq(organization.id, input.organizationId))
                    .limit(1)
                    .then((rows) => rows[0]),
                ctx.db
                    .select({ name: organization.name })
                    .from(organization)
                    .where(eq(organization.id, tenantId))
                    .limit(1)
                    .then((rows) => rows[0]),
            ]);

            if (!target || target.status === "closed") {
                throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
            }

            if (target.type !== counterpartType(ctx.tenant.orgType, input.relation)) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "WRONG_PARTNER_TYPE" });
            }

            const [existing] = await ctx.db
                .select({ id: partnerConnection.id, status: partnerConnection.status })
                .from(partnerConnection)
                .where(pairFilter(tenantId, input.organizationId))
                .limit(1);

            if (existing?.status === "accepted") {
                throw new TRPCError({ code: "CONFLICT", message: "ALREADY_CONNECTED" });
            }

            if (existing?.status === "pending") {
                throw new TRPCError({ code: "CONFLICT", message: "ALREADY_PENDING" });
            }

            const message = input.message?.trim() || null;
            let connectionId: string;

            if (existing) {
                // Declined or removed: the pair keeps its history, so the
                // request reopens the row and the requester becomes this
                // tenant whichever side asked last time
                const [updated] = await ctx.db
                    .update(partnerConnection)
                    .set({
                        requesterOrgId: tenantId,
                        targetOrgId: input.organizationId,
                        relation: input.relation,
                        status: "pending",
                        acceptedVia: null,
                        message,
                        requestedByUserId: ctx.tenant.userId,
                        respondedByUserId: null,
                        respondedAt: null,
                    })
                    .where(eq(partnerConnection.id, existing.id))
                    .returning({ id: partnerConnection.id });

                if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

                connectionId = updated.id;
            } else {
                try {
                    const [created] = await ctx.db
                        .insert(partnerConnection)
                        .values({
                            requesterOrgId: tenantId,
                            targetOrgId: input.organizationId,
                            relation: input.relation,
                            status: "pending",
                            message,
                            requestedByUserId: ctx.tenant.userId,
                        })
                        .returning({ id: partnerConnection.id });

                    if (!created) {
                        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
                    }

                    connectionId = created.id;
                } catch (error) {
                    // The pair index: the other side asked between the read
                    // above and this insert
                    if (uniqueViolationConstraint(error) !== null) {
                        throw new TRPCError({ code: "CONFLICT", message: "ALREADY_PENDING" });
                    }

                    throw error;
                }
            }

            await notify(ctx.db, {
                organizationId: input.organizationId,
                kind: "connection.requested",
                email: true,
                entityType: "connection",
                entityId: connectionId,
                params: { partnerName: self?.name ?? "", relation: input.relation },
            });

            return { id: connectionId };
        }),

    /**
     * Answers a request. Only the side that was asked may answer, and only
     * while it is still pending — a second click on a stale list finds
     * nothing to update rather than overwriting an answer.
     */
    respond: authorizedTenantProcedure("partner", ["respond"])
        .input(z.object({ id: z.string().nonempty(), decision: z.enum(["accept", "decline"]) }))
        .mutation(async ({ ctx, input }): Promise<{ id: string; status: "accepted" | "declined" }> => {
            const tenantId = ctx.tenant.organizationId;
            const status = input.decision === "accept" ? "accepted" : "declined";

            const [updated] = await ctx.db
                .update(partnerConnection)
                .set({
                    status,
                    acceptedVia: input.decision === "accept" ? "response" : null,
                    respondedByUserId: ctx.tenant.userId,
                    respondedAt: new Date(),
                })
                .where(and(
                    eq(partnerConnection.id, input.id),
                    eq(partnerConnection.targetOrgId, tenantId),
                    eq(partnerConnection.status, "pending"),
                ))
                .returning({ id: partnerConnection.id, requesterOrgId: partnerConnection.requesterOrgId });

            if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

            const [self] = await ctx.db
                .select({ name: organization.name })
                .from(organization)
                .where(eq(organization.id, tenantId))
                .limit(1);

            await notify(ctx.db, {
                organizationId: updated.requesterOrgId,
                kind: input.decision === "accept" ? "connection.accepted" : "connection.declined",
                // An acceptance opens a door and is worth an email; a decline
                // is read in the portal when the requester next looks
                email: input.decision === "accept",
                entityType: "connection",
                entityId: updated.id,
                params: { partnerName: self?.name ?? "" },
            });

            return { id: updated.id, status };
        }),

    /**
     * Ends an accepted connection from either side. The row is kept as
     * "removed" rather than deleted: the orders the two ran together hang off
     * both companies, and a later re-request reopens this same row.
     */
    remove: authorizedTenantProcedure("partner", ["remove"])
        .input(z.object({ id: z.string().nonempty() }))
        .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
            const tenantId = ctx.tenant.organizationId;

            const [updated] = await ctx.db
                .update(partnerConnection)
                .set({ status: "removed" })
                .where(and(
                    eq(partnerConnection.id, input.id),
                    tenantSideFilter(tenantId),
                    eq(partnerConnection.status, "accepted"),
                ))
                .returning({
                    id: partnerConnection.id,
                    requesterOrgId: partnerConnection.requesterOrgId,
                    targetOrgId: partnerConnection.targetOrgId,
                });

            if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

            const [self] = await ctx.db
                .select({ name: organization.name })
                .from(organization)
                .where(eq(organization.id, tenantId))
                .limit(1);

            await notify(ctx.db, {
                organizationId: updated.requesterOrgId === tenantId ? updated.targetOrgId : updated.requesterOrgId,
                kind: "connection.removed",
                email: false,
                entityType: "connection",
                entityId: updated.id,
                params: { partnerName: self?.name ?? "" },
            });

            return { id: updated.id };
        }),

    /**
     * Takes back a request nobody has answered. Deleted rather than marked
     * removed: nothing happened between the two companies, and a clean slate
     * lets either side ask again without the pair carrying a decision it
     * never made.
     */
    withdraw: authorizedTenantProcedure("partner", ["request"])
        .input(z.object({ id: z.string().nonempty() }))
        .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
            const [deleted] = await ctx.db
                .delete(partnerConnection)
                .where(and(
                    eq(partnerConnection.id, input.id),
                    eq(partnerConnection.requesterOrgId, ctx.tenant.organizationId),
                    eq(partnerConnection.status, "pending"),
                ))
                .returning({ id: partnerConnection.id });

            if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

            return { id: deleted.id };
        }),

    /**
     * Registers a partner nobody had in the database yet and connects to it
     * straight away. There is no one to ask: the company has no portal
     * account, so the connection is accepted on registration (`accepted_via
     * = registration`) and staff see who registered whom in the metadata.
     */
    register: authorizedTenantProcedure("partner", ["request"])
        .input(RegisterPartnerBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ organizationId: string; connectionId: string; name: string }> => {
            const tenantId = ctx.tenant.organizationId;

            assertRelationAllowed(ctx.tenant.orgType, input.relation);

            // Unbounded, this mutation writes an organization row per call —
            // and NUIT, phone and email are UNIQUE, so a loop would squat tax
            // numbers and phone numbers their real owners have not signed up
            // with yet. A tenant adding partners does so a handful at a time.
            const allowed = await withinRateLimit(ctx.db, {
                key: `partner-register:org:${tenantId}`,
                windowMs: 24 * 60 * 60 * 1000,
                max: 10,
            });

            if (!allowed) {
                throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "RATE_LIMITED" });
            }

            const slug = slugify(input.name) || "organization";
            // Always a placeholder, never the address the form collected:
            // `organization.email` is what a claim is auto-approved against
            // (onboarding.claim), so letting one tenant choose it for a
            // company it does not belong to hands that company away. The
            // supplied address is kept as a contact note for staff instead.
            const email = `missing-${crypto.randomUUID()}@appload.invalid`;
            const contactEmail = input.email?.trim() || null;

            let organizationId: string | null = null;

            for (let attempt = 0; attempt < 2 && organizationId === null; attempt++) {
                try {
                    const [created] = await ctx.db
                        .insert(organization)
                        .values({
                            id: crypto.randomUUID(),
                            name: input.name,
                            // Retry once with a random suffix on slug collision
                            slug: attempt === 0 ? slug : `${slug}-${crypto.randomUUID().slice(0, 4)}`,
                            nuit: input.nuit,
                            email,
                            phoneNumber: input.phone,
                            physicalAddress: toAddress(input.physicalAddress),
                            type: counterpartType(ctx.tenant.orgType, input.relation),
                            // Staff decide whether a company registered by a
                            // partner becomes an active one
                            status: "pending",
                            metadata: JSON.stringify({
                                registeredBy: tenantId,
                                registeredVia: "portal",
                                // Non-authoritative: a hint for whoever
                                // verifies the company, not an identity
                                ...(contactEmail ? { contactEmail } : {}),
                            }),
                            createdAt: new Date(),
                        })
                        .returning({ id: organization.id });

                    if (!created) {
                        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
                    }

                    organizationId = created.id;
                } catch (error) {
                    const constraint = uniqueViolationConstraint(error);

                    if (constraint === null) throw error;

                    // The NUIT is the one duplicate the caller can act on:
                    // the company is already here, so it is looked up and
                    // asked rather than registered
                    if (constraint.includes("nuit")) {
                        throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_NUIT" });
                    }
                    if (constraint.includes("email")) {
                        throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_EMAIL" });
                    }
                    if (constraint.includes("phone")) {
                        throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_PHONE" });
                    }
                    if (constraint.includes("slug") && attempt === 0) {
                        continue;
                    }

                    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
                }
            }

            if (organizationId === null) {
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
            }

            try {
                const [connection] = await ctx.db
                    .insert(partnerConnection)
                    .values({
                        requesterOrgId: tenantId,
                        targetOrgId: organizationId,
                        relation: input.relation,
                        status: "accepted",
                        acceptedVia: "registration",
                        requestedByUserId: ctx.tenant.userId,
                        respondedAt: new Date(),
                    })
                    .returning({ id: partnerConnection.id });

                if (!connection) {
                    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
                }

                // Nobody to notify: the company has no members yet
                return { organizationId, connectionId: connection.id, name: input.name };
            } catch (error) {
                // Compensation (neon-http has no transactions): a company
                // registered without its connection would be invisible to the
                // tenant that registered it, and its NUIT would block the retry
                await ctx.db.delete(organization).where(eq(organization.id, organizationId)).catch(() => undefined);

                throw error instanceof TRPCError
                    ? error
                    : new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN", cause: error });
            }
        }),

    /** The tenant's connections, one page at a time, joined to the other company. */
    list: tenantProcedure
        .input(z.object({
            relation: z.enum(CONNECTION_RELATION).optional(),
            status: z.enum(CONNECTION_STATUS).optional(),
            direction: z.enum(CONNECTION_DIRECTIONS).optional(),
            query: z.string().optional(),
            sort: z.enum(PARTNER_SORTS).optional(),
            dir: z.enum(["asc", "desc"]).optional(),
            page: z.number().int().positive().default(1),
            pageSize: z.number().int().refine((value) => (PAGE_SIZES as readonly number[]).includes(value)).default(25),
        }))
        .query(async ({ ctx, input }): Promise<PagedResult<PartnerRow>> => {
            const tenantId = ctx.tenant.organizationId;

            const filters: (SQL | undefined)[] = [tenantSideFilter(tenantId)];

            if (input.relation) filters.push(eq(partnerConnection.relation, input.relation));
            if (input.status) filters.push(eq(partnerConnection.status, input.status));
            if (input.direction === "incoming") filters.push(eq(partnerConnection.targetOrgId, tenantId));
            if (input.direction === "outgoing") filters.push(eq(partnerConnection.requesterOrgId, tenantId));

            const term = input.query?.trim();
            if (term) filters.push(ilike(organization.name, `%${escapeLike(term)}%`));

            const where = and(...filters);
            const direction = input.dir === "desc" ? desc : asc;

            const orderBy =
                input.sort === "since" ? direction(sinceExpr)
                    : input.sort === "orders" ? direction(sharedOrdersExpr)
                        : direction(organization.name);

            const [rows, [counted]] = await Promise.all([
                ctx.db
                    .select({
                        id: partnerConnection.id,
                        relation: partnerConnection.relation,
                        status: partnerConnection.status,
                        message: partnerConnection.message,
                        requesterOrgId: partnerConnection.requesterOrgId,
                        respondedAt: partnerConnection.respondedAt,
                        createdAt: partnerConnection.createdAt,
                        partnerId: organization.id,
                        partnerName: organization.name,
                        partnerType: organization.type,
                        partnerAddress: organization.physicalAddress,
                        partnerKycStatus: organization.kycStatus,
                        sharedOrders: sharedOrdersExpr,
                    })
                    .from(partnerConnection)
                    .innerJoin(organization, partnerJoin(tenantId))
                    .where(where)
                    .orderBy(orderBy)
                    .limit(input.pageSize)
                    .offset((input.page - 1) * input.pageSize),
                ctx.db
                    .select({ count: sql<number>`count(*)::int` })
                    .from(partnerConnection)
                    .innerJoin(organization, partnerJoin(tenantId))
                    .where(where),
            ]);

            return {
                items: rows.map((row) => ({
                    id: row.id,
                    relation: row.relation,
                    status: row.status,
                    direction: row.requesterOrgId === tenantId ? "outgoing" : "incoming",
                    message: row.message,
                    respondedAt: row.respondedAt,
                    createdAt: row.createdAt,
                    partner: {
                        id: row.partnerId,
                        name: row.partnerName,
                        type: row.partnerType,
                        province: row.partnerAddress?.state ?? null,
                        kycStatus: row.partnerKycStatus,
                    },
                    sharedOrders: row.sharedOrders,
                })),
                total: counted?.count ?? 0,
                page: input.page,
                pageSize: input.pageSize,
            };
        }),

    /**
     * One connection in full. Contact details and the shared-order history
     * are the reward for an accepted connection; a pending or ended one shows
     * the same narrow projection the search does.
     */
    profile: tenantProcedure
        .input(z.object({ id: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<PartnerProfile> => {
            const tenantId = ctx.tenant.organizationId;

            const [row] = await ctx.db
                .select({
                    id: partnerConnection.id,
                    relation: partnerConnection.relation,
                    status: partnerConnection.status,
                    acceptedVia: partnerConnection.acceptedVia,
                    message: partnerConnection.message,
                    requesterOrgId: partnerConnection.requesterOrgId,
                    respondedAt: partnerConnection.respondedAt,
                    createdAt: partnerConnection.createdAt,
                    partnerId: organization.id,
                    partnerName: organization.name,
                    partnerType: organization.type,
                    partnerEmail: organization.email,
                    partnerPhone: organization.phoneNumber,
                    partnerBillingAddress: organization.billingAddress,
                    partnerAddress: organization.physicalAddress,
                    partnerKycStatus: organization.kycStatus,
                })
                .from(partnerConnection)
                .innerJoin(organization, partnerJoin(tenantId))
                .where(and(eq(partnerConnection.id, input.id), tenantSideFilter(tenantId)))
                .limit(1);

            if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

            const accepted = row.status === "accepted";
            const direction: ConnectionDirection = row.requesterOrgId === tenantId ? "outgoing" : "incoming";

            const orders = accepted ? await sharedOrderSummary(ctx.db, tenantId, row.partnerId) : null;

            return {
                connection: {
                    id: row.id,
                    relation: row.relation,
                    status: row.status,
                    direction,
                    acceptedVia: row.acceptedVia,
                    message: row.message,
                    respondedAt: row.respondedAt,
                    createdAt: row.createdAt,
                },
                partner: {
                    id: row.partnerId,
                    name: row.partnerName,
                    type: row.partnerType,
                    province: row.partnerAddress?.state ?? null,
                    kycStatus: row.partnerKycStatus,
                    email: accepted ? row.partnerEmail : null,
                    phoneNumber: accepted ? row.partnerPhone : null,
                    billingAddress: accepted ? row.partnerBillingAddress : null,
                    physicalAddress: accepted ? row.partnerAddress : null,
                },
                orders,
            };
        }),

    /** The three numbers above the table: what is connected and what is waiting. */
    stats: tenantProcedure.query(async ({ ctx }): Promise<PartnerStats> => {
        const tenantId = ctx.tenant.organizationId;

        const [row] = await ctx.db
            .select({
                clients: sql<number>`count(*) filter (where ${partnerConnection.status} = 'accepted' and ${partnerConnection.relation} = 'client-carrier')::int`,
                subcontract: sql<number>`count(*) filter (where ${partnerConnection.status} = 'accepted' and ${partnerConnection.relation} = 'subcontract')::int`,
                incoming: sql<number>`count(*) filter (where ${partnerConnection.status} = 'pending' and ${partnerConnection.targetOrgId} = ${tenantId})::int`,
                outgoing: sql<number>`count(*) filter (where ${partnerConnection.status} = 'pending' and ${partnerConnection.requesterOrgId} = ${tenantId})::int`,
            })
            .from(partnerConnection)
            .where(tenantSideFilter(tenantId));

        return {
            accepted: {
                "client-carrier": row?.clients ?? 0,
                subcontract: row?.subcontract ?? 0,
            },
            incoming: row?.incoming ?? 0,
            outgoing: row?.outgoing ?? 0,
        };
    }),
});

type CandidateRow = {
    id: string;
    name: string;
    type: OrgType;
    physicalAddress: Address | null;
    kycStatus: PartnerCandidate["kycStatus"];
    connectionId: string | null;
    connectionStatus: ConnectionStatus | null;
    requesterOrgId: string | null;
};

/**
 * The shared projection of the two lookups. A declined or removed pair is
 * reported as no connection at all: it says nothing about the companies now,
 * and a fresh request is exactly what the caller may make.
 */
function toCandidate(row: CandidateRow, tenantId: string): PartnerCandidate {
    const live = row.connectionId !== null && (row.connectionStatus === "pending" || row.connectionStatus === "accepted");

    return {
        id: row.id,
        name: row.name,
        type: row.type,
        province: row.physicalAddress?.state ?? null,
        kycStatus: row.kycStatus,
        connection: live && row.connectionId && row.connectionStatus
            ? {
                id: row.connectionId,
                status: row.connectionStatus,
                direction: row.requesterOrgId === tenantId ? "outgoing" : "incoming",
            }
            : null,
    };
}

/**
 * What the two companies have run together: how many orders, when the last
 * one loaded, and where those orders stand. Both orientations count — a
 * carrier subcontracting to another carrier is the shipper on that leg.
 */
async function sharedOrderSummary(
    db: typeof Database,
    tenantId: string,
    partnerId: string,
): Promise<SharedOrders> {
    const rows = await db
        .select({
            status: order.status,
            count: sql<number>`count(*)::int`,
            lastLoading: sql<Date | null>`max(${order.expectedLoadingDate})`,
        })
        .from(order)
        .where(or(
            and(eq(order.shipperId, tenantId), eq(order.carrierId, partnerId)),
            and(eq(order.shipperId, partnerId), eq(order.carrierId, tenantId)),
        ))
        .groupBy(order.status);

    const total = rows.reduce((sum, row) => sum + row.count, 0);

    const lastLoadingDate = rows
        .map((row) => (row.lastLoading ? new Date(row.lastLoading) : null))
        .filter((value): value is Date => value !== null)
        .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;

    return {
        total,
        lastLoadingDate,
        byStatus: rows.map((row) => ({ status: row.status, count: row.count })),
    };
}
