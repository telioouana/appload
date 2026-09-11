import "server-only";

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, ilike, or, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { chatConversation, chatMessage } from "@workspace/db/chats";
import type { db as Database } from "@workspace/db/db";
import { driver, link, trailer, truck } from "@workspace/db/fleet";
import {
    movement,
    movementCost,
    movementDocument,
    movementLocation,
    movementRoute,
    type CreateMovement,
    type Movement,
} from "@workspace/db/movements";
import { user } from "@workspace/db/users";

import { isOrgAuthorized, type OrgRole } from "@workspace/auth/organization-permissions";
import {
    locationRequestText,
    sendWhatsAppLocationRequest,
    sendWhatsAppTemplate,
    shareLocationPayload,
    trackingTemplateText,
} from "@workspace/comms/infobip";
import { announce, recordEvent, statusStamps, transitionMovement, type MovementActor } from "@workspace/domain/movements/apply";
import { isConnected, isOnPortal, terminalMovementId } from "@workspace/domain/movements/link";
import { settlementStatus } from "@workspace/domain/movements/money";
import { assertExecutor, convertMovement, offerMovement, respondToOffer, withdrawOffer } from "@workspace/domain/movements/offer";
import { editableGroups, movementRole, type EditableGroup } from "@workspace/domain/movements/policy";
import { movementRef } from "@workspace/domain/movements/refs";
import { transitionBlocker } from "@workspace/domain/movements/status";
import { notify } from "@workspace/domain/notifications";
import { assertTrackingAllowance, recordTrackingUsage } from "@workspace/domain/subscription";
import { startConversation } from "@workspace/domain/tracking/conversations";
import { hasOpenSession, place } from "@workspace/domain/tracking/slot";

import { computeRoute } from "@workspace/maps/server/routes";
import {
    cacheKey,
    failedRecently,
    failureKey,
    GEOCODE_TTL_MS,
    num,
    rememberFailure,
    routeFailures,
    toRouteDto,
    trailSource,
} from "@workspace/maps/server/route-cache";
import type { OrderRouteDto, TrailPoint } from "@workspace/maps/types";

import { createTRPCRouter } from "@workspace/trpc/init";
import { tenantProcedure } from "@workspace/trpc/tenant";

import { withinRateLimit } from "@/lib/rate-limit";
import {
    AddCostBaseSchema,
    AddMovementDocumentBaseSchema,
    ConvertMovementBaseSchema,
    CreateMovementBaseSchema,
    OfferMovementBaseSchema,
    RecordPaymentBaseSchema,
    RespondOfferBaseSchema,
    TransitionMovementBaseSchema,
    UpdateMovementBaseSchema,
    WithdrawOfferBaseSchema,
    type MoneyLegInput,
    type UpdateMovementInput,
} from "@/backend/schemas/movement";
import { assertEdgeStoreUrl } from "@/frontend/pages/orders/server/projection";
import {
    hasParentRow,
    loadCosts,
    loadDocuments,
    loadEvents,
    loadNames,
    loadOwn,
    loadPings,
    loadVisible,
    sectionPredicate,
    toMovementDetail,
    toMovementRow,
    trailIds,
    visibleMovements,
} from "@/frontend/pages/movements/server/projection";
import {
    MOVEMENT_SCOPES,
    MOVEMENT_SORTS,
    ORDER_SECTIONS,
    PAGE_SIZES,
    TRIP_SECTIONS,
    type MovementDetail,
    type MovementRow,
    type MovementSection,
    type MovementStats,
    type PagedResult,
} from "@/frontend/pages/movements/types";

type Db = typeof Database;

/**
 * The portal's own loads: one router for both of its lists. What changes
 * status, places an offer or answers one goes through the domain doors
 * (packages/domain/src/movements); this file shapes input, checks who may
 * ask, and hands every response to projection.ts to be cut down to what the
 * caller may see.
 */

const actorOf = (tenant: { organizationId: string; userId: string }): MovementActor => ({
    organizationId: tenant.organizationId,
    userId: tenant.userId,
});

/**
 * The member's own role, checked after the row is loaded — which statement
 * applies depends on the row: a load the company's own fleet moves is a
 * trip, one it hands to a partner is an order, and placing a load with
 * somebody commits the company to paying them.
 */
function assertCan(role: OrgRole, resource: "trip" | "order" | "offer" | "document", action: string): void {
    if (!isOrgAuthorized(role, resource, [action] as never)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED" });
    }
}

const writeResource = (row: Pick<Movement, "execution">) => (row.execution === "partner" ? "order" : "trip");

// Escape LIKE wildcards so what the user typed matches literally
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const decimal = (value: number | undefined | null): string | null =>
    value === undefined || value === null ? null : String(Math.round(value * 100) / 100);

/** A money leg as the row's columns, for one side. */
function legColumns(side: "sell" | "buy", value: MoneyLegInput | null): Partial<CreateMovement> {
    if (side === "sell") {
        return {
            sellSubtotal: decimal(value?.subtotal),
            sellVat: decimal(value?.vat),
            sellTotal: decimal(value?.total),
            sellCurrency: value?.currency ?? null,
            sellFiscalRegime: value?.fiscalRegime ?? null,
            ...(value && { sellSettlement: "pending" as const }),
        };
    }

    return {
        buySubtotal: decimal(value?.subtotal),
        buyVat: decimal(value?.vat),
        buyTotal: decimal(value?.total),
        buyCurrency: value?.currency ?? null,
        buyFiscalRegime: value?.fiscalRegime ?? null,
        ...(value && { buySettlement: "pending" as const }),
    };
}

/**
 * A rig named from the fleet has to be the company's own, and a driver named
 * from it brings their name and phone — the tracking asks the phone on file,
 * not whatever was typed beside the picker.
 */
async function resolveRig(
    db: Db,
    tenantId: string,
    input: { driverId?: string | null; truckId?: string | null; trailerId?: string | null; linkId?: string | null },
): Promise<Partial<CreateMovement>> {
    const patch: Partial<CreateMovement> = {};
    const refuse = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });

    if (input.driverId) {
        const [row] = await db
            .select({ name: user.name, phone: user.phoneNumber })
            .from(driver)
            .innerJoin(user, eq(user.id, driver.userId))
            .where(and(eq(driver.id, input.driverId), eq(driver.carrierId, tenantId)))
            .limit(1);

        if (!row) throw refuse("DRIVER_NOT_REGISTERED");

        patch.driverId = input.driverId;
        patch.driverName = row.name;
        if (row.phone) patch.driverPhone = row.phone;
    }

    if (input.truckId) {
        const [row] = await db
            .select({ plate: truck.regPlate })
            .from(truck)
            .where(and(eq(truck.id, input.truckId), eq(truck.carrierId, tenantId)))
            .limit(1);

        if (!row) throw refuse("TRUCK_NOT_REGISTERED");

        patch.truckId = input.truckId;
        patch.truckPlate = row.plate;
    }

    if (input.trailerId) {
        const [row] = await db
            .select({ id: trailer.id })
            .from(trailer)
            .where(and(eq(trailer.id, input.trailerId), eq(trailer.carrierId, tenantId)))
            .limit(1);

        if (!row) throw refuse("TRAILER_NOT_REGISTERED");
        patch.trailerId = input.trailerId;
    }

    if (input.linkId) {
        const [row] = await db
            .select({ id: link.id })
            .from(link)
            .where(and(eq(link.id, input.linkId), eq(link.carrierId, tenantId)))
            .limit(1);

        if (!row) throw refuse("LINK_NOT_REGISTERED");
        patch.linkId = input.linkId;
    }

    return patch;
}

const hasRigInput = (input: Record<string, unknown>) =>
    ["driverName", "driverPhone", "driverId", "truckPlate", "truckId", "trailerId", "linkId"]
        .some((key) => input[key] !== undefined && input[key] !== null);

/** Which editable block each patch field belongs to (policy.ts). */
const FIELD_GROUP: Partial<Record<keyof UpdateMovementInput, EditableGroup>> = {
    origin: "details",
    destination: "details",
    route: "details",
    cargoDescription: "details",
    category: "details",
    weight: "details",
    weightUnit: "details",
    expectedLoadingDate: "details",
    expectedDeliveryAt: "details",
    clientOrgId: "client",
    clientName: "client",
    clientReference: "client",
    sell: "sellAmounts",
    carrierOrgId: "buy",
    carrierName: "buy",
    buy: "buy",
    driverName: "rig",
    driverPhone: "rig",
    driverId: "rig",
    truckPlate: "rig",
    truckId: "rig",
    trailerId: "rig",
    linkId: "rig",
    sellInvoice: "paperwork",
    buyInvoice: "paperwork",
    notes: "paperwork",
};

const ListInput = z.object({
    scope: z.enum(MOVEMENT_SCOPES),
    section: z.enum([...new Set([...ORDER_SECTIONS, ...TRIP_SECTIONS])] as [MovementSection, ...MovementSection[]]).default("all"),
    search: z.string().trim().max(120).optional(),
    sort: z.enum(MOVEMENT_SORTS).default("newest"),
    dir: z.enum(["asc", "desc"]).default("desc"),
    page: z.number().int().positive().default(1),
    pageSize: z.number().int().refine((value) => (PAGE_SIZES as readonly number[]).includes(value)).default(25),
});

type ListInput = z.infer<typeof ListInput>;

/** The reference, the driver, the plate and the cargo are what a load is looked up by. */
function searchWhere(term: string): SQL | undefined {
    const pattern = `%${escapeLike(term)}%`;
    const digits = term.replace(/\D/g, "");
    // "ORD-42", "trp 42" and "42" all mean the same row; anything longer than
    // a plausible sequence is a plate or a name, not a reference
    const seq = digits.length > 0 && digits.length <= 9 ? Number(digits) : null;

    return or(
        ilike(movement.driverName, pattern),
        ilike(movement.truckPlate, pattern),
        ilike(movement.cargoDescription, pattern),
        ilike(movement.clientReference, pattern),
        seq === null ? undefined : eq(movement.seq, seq),
    );
}

function ordering(sort: ListInput["sort"], dir: "asc" | "desc"): SQL[] {
    const by = (column: AnyColumn) =>
        dir === "desc" ? sql`${column} desc nulls last` : sql`${column} asc nulls last`;

    switch (sort) {
        case "loading": return [by(movement.expectedLoadingDate), desc(movement.seq)];
        case "delivery": return [by(movement.expectedDeliveryAt), desc(movement.seq)];
        default: return [by(movement.createdAt), desc(movement.seq)];
    }
}

/** A page of rows cut down for this caller, with the names and trails it needs. */
async function projectRows(db: Db, rows: Movement[], tenantId: string): Promise<MovementRow[]> {
    const roles = rows.map((row) => ({ row, role: roleOrThrow(row, tenantId) }));
    const trails = await trailIds(db, rows);
    const [names, pings] = await Promise.all([
        loadNames(db, rows.flatMap((row) => [row.organizationId, row.clientOrgId, row.carrierOrgId])),
        loadPings(db, [...trails.values()]),
    ]);

    return roles.map(({ row, role }) => toMovementRow(row, role, { names, pings, trailId: trails.get(row.id) ?? row.id }));
}

function roleOrThrow(row: Movement, tenantId: string) {
    const role = movementRole(row, tenantId);
    // The list predicates only ever return rows the caller is a side of; a
    // row with no role here would be a bug in them, and it must not render
    if (!role) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
    return role;
}

async function detailOf(db: Db, row: Movement, tenantId: string, orgRole: OrgRole): Promise<MovementDetail> {
    const role = roleOrThrow(row, tenantId);
    const owner = role === "owner";
    const trailId = row.executionMovementId ? await terminalMovementId(db, row.id) : row.id;

    const [names, pings, costs, documents, events, hasParent, executorOnPortal] = await Promise.all([
        loadNames(db, [row.organizationId, row.clientOrgId, row.carrierOrgId]),
        loadPings(db, [trailId]),
        owner ? loadCosts(db, row.id) : Promise.resolve([]),
        loadDocuments(db, row.id),
        loadEvents(db, row.id),
        owner ? hasParentRow(db, row.id) : Promise.resolve(false),
        row.execution === "partner" ? isOnPortal(db, row.carrierOrgId) : Promise.resolve(false),
    ]);

    return toMovementDetail(row, role, {
        names,
        pings,
        trailId,
        hasParent,
        executorOnPortal,
        costs,
        documents,
        events,
        orgRole,
    });
}

export const movementsRouter = createTRPCRouter({
    /** One page of one section of one of the two lists. */
    list: tenantProcedure
        .input(ListInput)
        .query(async ({ ctx, input }): Promise<PagedResult<MovementRow>> => {
            const tenantId = ctx.tenant.organizationId;
            const where = and(
                visibleMovements(tenantId),
                sectionPredicate(input.scope, input.section, tenantId),
                input.search ? searchWhere(input.search) : undefined,
            );

            const [rows, [counted]] = await Promise.all([
                ctx.db
                    .select()
                    .from(movement)
                    .where(where)
                    .orderBy(...ordering(input.sort, input.dir))
                    .limit(input.pageSize)
                    .offset((input.page - 1) * input.pageSize),
                ctx.db.select({ value: count() }).from(movement).where(where),
            ]);

            return {
                items: await projectRows(ctx.db, rows, tenantId),
                total: counted?.value ?? 0,
                page: input.page,
                pageSize: input.pageSize,
            };
        }),

    /**
     * The counts behind one list's tabs, in one scan per section of exactly
     * the predicate its tab opens — so a number always agrees with its list.
     */
    stats: tenantProcedure
        .input(z.object({ scope: z.enum(MOVEMENT_SCOPES) }))
        .query(async ({ ctx, input }): Promise<MovementStats> => {
            const tenantId = ctx.tenant.organizationId;
            const sections: readonly MovementSection[] = input.scope === "orders" ? ORDER_SECTIONS : TRIP_SECTIONS;

            const select = Object.fromEntries(sections.map((section) => [
                section,
                sql<number>`count(*) filter (where ${sectionPredicate(input.scope, section, tenantId)})::int`.mapWith(Number),
            ]));

            const [row] = await ctx.db
                .select(select as Record<string, SQL<number>>)
                .from(movement)
                .where(visibleMovements(tenantId));

            const bySection = Object.fromEntries(sections.map((section) => [section, Number(row?.[section] ?? 0)]));

            return {
                total: bySection.all ?? 0,
                bySection,
                inbox: input.scope === "orders" ? bySection.inbox ?? 0 : 0,
            };
        }),

    /**
     * One load in full, as this caller may see it. The buttons come from
     * `permissions`, decided from the same rules the doors enforce.
     */
    get: tenantProcedure
        .input(z.object({ id: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<MovementDetail> => {
            const { row } = await loadVisible(ctx.db, input.id, ctx.tenant.organizationId);
            return detailOf(ctx.db, row, ctx.tenant.organizationId, ctx.tenant.role);
        }),

    /**
     * Files a load. Its own truck, or a partner's; for somebody, or for the
     * company itself. It starts in procurement unless the caller says it is
     * already scheduled or on the road — the same rules as moving it there
     * later, checked the same way, and "already on the road" is the half that
     * spends a tracked movement.
     */
    create: tenantProcedure
        .input(CreateMovementBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string; ref: string }> => {
            const tenantId = ctx.tenant.organizationId;
            const partner = input.execution === "partner";

            assertCan(ctx.tenant.role, partner ? "order" : "trip", "create");

            if (!partner && (input.carrierOrgId || input.carrierName || input.buy)) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "OWN_FLEET_HAS_NO_CARRIER" });
            }

            if (input.clientOrgId && !(await isConnected(ctx.db, tenantId, input.clientOrgId))) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "PARTNER_NOT_CONNECTED" });
            }

            if (partner && input.carrierOrgId) await assertExecutor(ctx.db, tenantId, input.carrierOrgId);

            const executorOnPortal = partner && await isOnPortal(ctx.db, input.carrierOrgId ?? null);

            // A partner on the portal names its own driver, in its own row
            if (executorOnPortal && hasRigInput(input)) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "RIG_IS_THE_PARTNERS" });
            }

            // ...and is asked, never scheduled on its behalf
            if (executorOnPortal && input.status !== "procurement") {
                throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_STATUS" });
            }

            const rig = await resolveRig(ctx.db, tenantId, input);
            const values: CreateMovement = {
                organizationId: tenantId,
                execution: input.execution,
                status: input.status,
                origin: input.origin,
                destination: input.destination,
                route: input.route,
                cargoDescription: input.cargoDescription || null,
                category: input.category ?? null,
                weight: decimal(input.weight),
                weightUnit: input.weightUnit ?? null,
                expectedLoadingDate: input.expectedLoadingDate ?? null,
                expectedDeliveryAt: input.expectedDeliveryAt ?? null,
                clientOrgId: input.clientOrgId ?? null,
                clientName: input.clientOrgId ? null : input.clientName || null,
                clientReference: input.clientReference || null,
                carrierOrgId: partner ? input.carrierOrgId ?? null : null,
                carrierName: partner && !input.carrierOrgId ? input.carrierName || null : null,
                driverName: input.driverName || null,
                driverPhone: input.driverPhone ?? null,
                truckPlate: input.truckPlate || null,
                ...rig,
                ...legColumns("sell", input.sell ?? null),
                ...(partner ? legColumns("buy", input.buy ?? null) : {}),
                notes: input.notes || null,
                createdBy: ctx.tenant.userId,
            };

            if (input.status !== "procurement") {
                const blocker = transitionBlocker(
                    {
                        execution: input.execution,
                        status: "procurement",
                        driverName: values.driverName ?? null,
                        driverPhone: values.driverPhone ?? null,
                        carrierOrgId: values.carrierOrgId ?? null,
                        carrierName: values.carrierName ?? null,
                        buyTotal: values.buyTotal ?? null,
                        buyCurrency: values.buyCurrency ?? null,
                        sellSettled: true,
                        buySettled: true,
                    },
                    input.status,
                );

                if (blocker) throw new TRPCError({ code: "PRECONDITION_FAILED", message: blocker });
            }

            if (input.status === "in-transit") await assertTrackingAllowance(ctx.db, tenantId);

            const [created] = await ctx.db
                .insert(movement)
                .values({ ...values, ...statusStamps(input.status, new Date()) })
                .returning();

            if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });

            await recordEvent(ctx.db, {
                movementId: created.id,
                kind: "status",
                actor: actorOf(ctx.tenant),
                toStatus: created.status,
                metadata: { action: "created" },
            });

            if (created.status === "in-transit") {
                await recordTrackingUsage(ctx.db, {
                    organizationIds: [tenantId],
                    entityType: "movement",
                    entityId: created.id,
                });

                await announce(ctx.db, created, { actorOrgId: tenantId, notifyOwner: false, notifyExecutor: false });
            }

            return { id: created.id, ref: movementRef(created.seq, created.execution) };
        }),

    /**
     * Corrects a load. Which blocks may still change depends on where it is
     * and who else agreed to it (policy.ts); a block the caller may not write
     * is refused outright rather than quietly dropped, so a form that thinks
     * it saved something always did.
     */
    update: tenantProcedure
        .input(UpdateMovementBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string; version: number }> => {
            const tenantId = ctx.tenant.organizationId;
            const row = await loadOwn(ctx.db, input.id, tenantId);

            assertCan(ctx.tenant.role, writeResource(row), "update");

            if (row.version !== input.expectedVersion) {
                throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
            }

            const partner = row.execution === "partner";
            const [hasParent, executorOnPortal] = await Promise.all([
                hasParentRow(ctx.db, row.id),
                partner ? isOnPortal(ctx.db, input.carrierOrgId ?? row.carrierOrgId) : Promise.resolve(false),
            ]);

            const groups = editableGroups({
                execution: row.execution,
                status: row.status,
                linked: row.executionMovementId !== null,
                hasParent,
                executorOnPortal,
            });

            const touched = (Object.keys(input) as (keyof UpdateMovementInput)[])
                .filter((key) => input[key] !== undefined && FIELD_GROUP[key]);

            for (const key of touched) {
                if (!groups.includes(FIELD_GROUP[key]!)) {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "FIELD_LOCKED" });
                }
            }

            if (!partner && (input.carrierOrgId || input.carrierName || input.buy)) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "OWN_FLEET_HAS_NO_CARRIER" });
            }

            // Who the partner is changes only before anybody was asked:
            // swapping it on a scheduled load would leave an order half
            // placed with one company and half with another
            if ((input.carrierOrgId !== undefined || input.carrierName !== undefined)
                && row.status !== "procurement" && row.status !== "declined") {
                throw new TRPCError({ code: "BAD_REQUEST", message: "FIELD_LOCKED" });
            }

            if (input.carrierOrgId) await assertExecutor(ctx.db, tenantId, input.carrierOrgId);

            if (input.clientOrgId && !(await isConnected(ctx.db, tenantId, input.clientOrgId))) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "PARTNER_NOT_CONNECTED" });
            }

            if (executorOnPortal && hasRigInput(input)) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "RIG_IS_THE_PARTNERS" });
            }

            const patch: Partial<CreateMovement> = {};
            const set = <K extends keyof CreateMovement>(key: K, value: CreateMovement[K] | undefined) => {
                if (value !== undefined) patch[key] = value;
            };

            set("origin", input.origin);
            set("destination", input.destination);
            set("route", input.route);
            set("cargoDescription", input.cargoDescription === undefined ? undefined : input.cargoDescription || null);
            set("category", input.category);
            set("weight", input.weight === undefined ? undefined : decimal(input.weight));
            set("weightUnit", input.weightUnit);
            set("expectedLoadingDate", input.expectedLoadingDate);
            set("expectedDeliveryAt", input.expectedDeliveryAt);
            set("clientOrgId", input.clientOrgId);
            set("clientName", input.clientName === undefined ? undefined : input.clientName || null);
            set("clientReference", input.clientReference === undefined ? undefined : input.clientReference || null);
            set("carrierOrgId", input.carrierOrgId);
            set("carrierName", input.carrierName === undefined ? undefined : input.carrierName || null);
            set("driverName", input.driverName === undefined ? undefined : input.driverName || null);
            set("driverPhone", input.driverPhone);
            set("truckPlate", input.truckPlate === undefined ? undefined : input.truckPlate || null);
            set("notes", input.notes === undefined ? undefined : input.notes || null);

            // A named organization and a typed name are the same slot
            if (input.clientOrgId) patch.clientName = null;
            if (input.carrierOrgId) patch.carrierName = null;

            for (const key of ["driverId", "truckId", "trailerId", "linkId"] as const) {
                if (input[key] === null) patch[key] = null;
            }

            Object.assign(patch, await resolveRig(ctx.db, tenantId, {
                driverId: input.driverId,
                truckId: input.truckId,
                trailerId: input.trailerId,
                linkId: input.linkId,
            }));

            if (input.sell !== undefined) Object.assign(patch, legColumns("sell", input.sell));
            if (input.buy !== undefined) Object.assign(patch, legColumns("buy", input.buy));
            if (input.sellInvoice) {
                set("sellInvoiceNumber", input.sellInvoice.invoiceNumber || null);
                set("sellInvoiceDate", input.sellInvoice.invoiceDate ?? null);
            }
            if (input.buyInvoice) {
                set("buyInvoiceNumber", input.buyInvoice.invoiceNumber || null);
                set("buyInvoiceDate", input.buyInvoice.invoiceDate ?? null);
            }

            if (Object.keys(patch).length === 0) return { id: row.id, version: row.version };

            const [updated] = await ctx.db
                .update(movement)
                .set({ ...patch, version: sql`${movement.version} + 1` })
                .where(and(eq(movement.id, row.id), eq(movement.version, input.expectedVersion)))
                .returning({ id: movement.id, version: movement.version });

            if (!updated) throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });

            await recordEvent(ctx.db, {
                movementId: row.id,
                kind: "update",
                actor: actorOf(ctx.tenant),
                // Which blocks changed, never their values: the trail is read
                // by whoever else is on the load
                metadata: {
                    action: "updated",
                    groups: [...new Set(touched.map((key) => FIELD_GROUP[key]))].join(","),
                },
            });

            return updated;
        }),

    /** Moves a load the owner may move (status.ts decides which). */
    transition: tenantProcedure
        .input(TransitionMovementBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string; status: Movement["status"]; version: number }> => {
            const row = await loadOwn(ctx.db, input.id, ctx.tenant.organizationId);
            assertCan(ctx.tenant.role, writeResource(row), "update");

            const updated = await transitionMovement(ctx.db, actorOf(ctx.tenant), input);
            return { id: updated.id, status: updated.status, version: updated.version };
        }),

    /** Places a load with a partner that can answer on the portal. */
    offer: tenantProcedure
        .input(OfferMovementBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string; version: number }> => {
            assertCan(ctx.tenant.role, "order", "create");
            const updated = await offerMovement(ctx.db, actorOf(ctx.tenant), input);
            return { id: updated.id, version: updated.version };
        }),

    /** Takes an unanswered offer back. */
    withdraw: tenantProcedure
        .input(WithdrawOfferBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string; version: number }> => {
            assertCan(ctx.tenant.role, "order", "update");
            const updated = await withdrawOffer(ctx.db, actorOf(ctx.tenant), input);
            return { id: updated.id, version: updated.version };
        }),

    /**
     * The executor's answer to an offer. A yes creates the executor's own
     * row — its reference is what comes back, since that is where the
     * executor works the load from now on.
     */
    respond: tenantProcedure
        .input(RespondOfferBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string; ref: string | null }> => {
            assertCan(ctx.tenant.role, "offer", "update");
            const result = await respondToOffer(ctx.db, actorOf(ctx.tenant), input);
            return { id: result.executorMovementId ?? result.movement.id, ref: result.executorRef };
        }),

    /** Hands an own-fleet load to a partner, or takes a partner's back in-house. */
    convert: tenantProcedure
        .input(ConvertMovementBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string; ref: string; version: number }> => {
            assertCan(ctx.tenant.role, "order", "create");
            const updated = await convertMovement(ctx.db, actorOf(ctx.tenant), input);
            return { id: updated.id, ref: movementRef(updated.seq, updated.execution), version: updated.version };
        }),

    /**
     * Money moved against one leg — received from the client, or paid to the
     * partner. Each payment is a line on the trail (owner-only, like every
     * money line); the row keeps the running total and derives the leg's
     * settlement from it with the same thresholds the order legs use.
     */
    recordPayment: tenantProcedure
        .input(RecordPaymentBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ id: string; version: number }> => {
            const row = await loadOwn(ctx.db, input.id, ctx.tenant.organizationId);
            assertCan(ctx.tenant.role, "order", "update");

            if (row.version !== input.expectedVersion) {
                throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
            }

            const sell = input.leg === "sell";
            const total = sell ? row.sellTotal : row.buyTotal;

            if (total === null || (!sell && row.execution !== "partner")) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "NO_SUCH_LEG" });
            }

            if (row.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_STATUS" });

            const settled = Math.round((Number((sell ? row.sellReceivedAmount : row.buyPaidAmount) ?? 0) + input.amount) * 100) / 100;
            const status = settlementStatus(Number(total), settled);
            const paidAt = input.paidAt ?? new Date();

            const [updated] = await ctx.db
                .update(movement)
                .set({
                    ...(sell
                        ? { sellReceivedAmount: String(settled), sellSettlement: status, sellSettledAt: status === "completed" ? paidAt : null }
                        : { buyPaidAmount: String(settled), buySettlement: status, buySettledAt: status === "completed" ? paidAt : null }),
                    version: sql`${movement.version} + 1`,
                })
                .where(and(eq(movement.id, row.id), eq(movement.version, input.expectedVersion)))
                .returning({ id: movement.id, version: movement.version });

            if (!updated) throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });

            await recordEvent(ctx.db, {
                movementId: row.id,
                kind: "money",
                actor: actorOf(ctx.tenant),
                note: input.reference,
                metadata: {
                    action: sell ? "received" : "paid",
                    leg: input.leg,
                    amount: input.amount,
                    paidAt: paidAt.toISOString(),
                },
            });

            return updated;
        }),

    costs: createTRPCRouter({
        /** What the load cost to run, one line at a time. Owner only, always. */
        add: tenantProcedure
            .input(AddCostBaseSchema)
            .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
                const row = await loadOwn(ctx.db, input.movementId, ctx.tenant.organizationId);
                assertCan(ctx.tenant.role, "trip", "update");

                if (row.status === "closed" || row.status === "cancelled") {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "MOVEMENT_CLOSED" });
                }

                const [created] = await ctx.db
                    .insert(movementCost)
                    .values({
                        movementId: row.id,
                        kind: input.kind,
                        description: input.description || null,
                        amount: String(Math.round(input.amount * 100) / 100),
                        currency: input.currency,
                        incurredAt: input.incurredAt ?? new Date(),
                        rechargeable: input.rechargeable,
                        createdBy: ctx.tenant.userId,
                    })
                    .returning({ id: movementCost.id });

                if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });

                await recordEvent(ctx.db, {
                    movementId: row.id,
                    kind: "cost",
                    actor: actorOf(ctx.tenant),
                    metadata: { action: "added", kind: input.kind, amount: input.amount, currency: input.currency },
                });

                return created;
            }),

        /**
         * Takes a cost line out of the totals. Soft: a line somebody already
         * reconciled does not vanish, it is marked as withdrawn.
         */
        remove: tenantProcedure
            .input(z.object({ id: z.string().nonempty() }))
            .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
                const [cost] = await ctx.db
                    .select({ id: movementCost.id, movementId: movementCost.movementId })
                    .from(movementCost)
                    .innerJoin(movement, eq(movement.id, movementCost.movementId))
                    .where(and(
                        eq(movementCost.id, input.id),
                        eq(movement.organizationId, ctx.tenant.organizationId),
                        sql`${movementCost.deletedAt} is null`,
                    ))
                    .limit(1);

                if (!cost) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
                assertCan(ctx.tenant.role, "trip", "update");

                await ctx.db
                    .update(movementCost)
                    .set({ deletedAt: new Date(), deletedBy: ctx.tenant.userId })
                    .where(eq(movementCost.id, cost.id));

                await recordEvent(ctx.db, {
                    movementId: cost.movementId,
                    kind: "cost",
                    actor: actorOf(ctx.tenant),
                    metadata: { action: "removed" },
                });

                return { id: cost.id };
            }),
    }),

    documents: createTRPCRouter({
        /**
         * Files a paper against the load. The owner writes; the leg decides
         * who else reads it — a POD (no leg) is everybody's on the load, a
         * sell-leg invoice is the owner's and its client's, a buy-leg receipt
         * the owner's and its partner's.
         */
        add: tenantProcedure
            .input(AddMovementDocumentBaseSchema)
            .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
                const row = await loadOwn(ctx.db, input.movementId, ctx.tenant.organizationId);
                assertCan(ctx.tenant.role, "document", "upload");
                assertEdgeStoreUrl(input.url);

                if (input.leg === "buy" && row.execution !== "partner") {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "NO_SUCH_LEG" });
                }

                if (input.costId) {
                    const [cost] = await ctx.db
                        .select({ id: movementCost.id })
                        .from(movementCost)
                        .where(and(eq(movementCost.id, input.costId), eq(movementCost.movementId, row.id)))
                        .limit(1);

                    if (!cost) throw new TRPCError({ code: "BAD_REQUEST", message: "COST_NOT_FOUND" });
                }

                const [created] = await ctx.db
                    .insert(movementDocument)
                    .values({
                        movementId: row.id,
                        type: input.type,
                        leg: input.leg ?? null,
                        title: input.title || null,
                        url: input.url,
                        size: input.size ?? null,
                        mimeType: input.mimeType || null,
                        costId: input.costId ?? null,
                        uploadedBy: ctx.tenant.userId,
                    })
                    .returning({ id: movementDocument.id });

                if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });

                await recordEvent(ctx.db, {
                    movementId: row.id,
                    kind: "document",
                    actor: actorOf(ctx.tenant),
                    metadata: { action: "added", type: input.type, leg: input.leg ?? null },
                });

                // The company on the other side of that paper hears about it
                const recipient = input.leg === "buy" ? row.carrierOrgId : row.clientOrgId;

                if (recipient) {
                    await notify(ctx.db, {
                        organizationId: recipient,
                        kind: "movement.document",
                        email: false,
                        entityType: "movement",
                        entityId: row.id,
                        params: { ref: movementRef(row.seq, row.execution), type: input.type },
                    });
                }

                return created;
            }),

        remove: tenantProcedure
            .input(z.object({ id: z.string().nonempty() }))
            .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
                const [document] = await ctx.db
                    .select({ id: movementDocument.id, movementId: movementDocument.movementId })
                    .from(movementDocument)
                    .innerJoin(movement, eq(movement.id, movementDocument.movementId))
                    .where(and(
                        eq(movementDocument.id, input.id),
                        eq(movement.organizationId, ctx.tenant.organizationId),
                        sql`${movementDocument.deletedAt} is null`,
                    ))
                    .limit(1);

                if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
                assertCan(ctx.tenant.role, "document", "upload");

                await ctx.db
                    .update(movementDocument)
                    .set({ deletedAt: new Date(), deletedBy: ctx.tenant.userId })
                    .where(eq(movementDocument.id, document.id));

                await recordEvent(ctx.db, {
                    movementId: document.movementId,
                    kind: "document",
                    actor: actorOf(ctx.tenant),
                    metadata: { action: "removed" },
                });

                return { id: document.id };
            }),
    }),

    /**
     * Every position reported for the load, oldest first. A linked order
     * reads the trail of the row with the truck — the positions and nothing
     * else of it: a ping is coordinates and a place name, with no company,
     * no price and no phone on it.
     */
    trail: tenantProcedure
        .input(z.object({ id: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<TrailPoint[]> => {
            const { row } = await loadVisible(ctx.db, input.id, ctx.tenant.organizationId);
            const trailId = row.executionMovementId ? await terminalMovementId(ctx.db, row.id) : row.id;

            const points = await ctx.db
                .select({
                    id: movementLocation.id,
                    latitude: movementLocation.latitude,
                    longitude: movementLocation.longitude,
                    placeName: movementLocation.placeName,
                    recordedAt: movementLocation.recordedAt,
                    source: movementLocation.source,
                })
                .from(movementLocation)
                .where(eq(movementLocation.movementId, trailId))
                .orderBy(asc(movementLocation.recordedAt));

            return points.map((point) => ({
                id: point.id,
                lat: num(point.latitude),
                lng: num(point.longitude),
                placeName: point.placeName,
                recordedAt: point.recordedAt,
                source: trailSource(point.source),
            }));
        }),

    /**
     * The drawn road route for the load, cached in `movement_route` under the
     * same rules as an order's: recomputed when either endpoint changed or a
     * geocode-only answer went stale, a compute failure falls back to what is
     * cached, and a failure with nothing cached is remembered for a quarter
     * of an hour so a lane Google cannot resolve is not re-bought on every
     * open. A linked order draws its own cache — same lane, same endpoints —
     * rather than reaching into the executor's row.
     */
    route: tenantProcedure
        .input(z.object({ id: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<OrderRouteDto> => {
            const { row } = await loadVisible(ctx.db, input.id, ctx.tenant.organizationId);
            // The map contract names its subject `orderId`; the load's own
            // reference is what goes in it, and nothing reads it but a label
            const ref = movementRef(row.seq, row.execution);

            const [cached] = await ctx.db
                .select()
                .from(movementRoute)
                .where(eq(movementRoute.movementId, row.id))
                .limit(1);

            const fresh = cached
                && cached.originPlaceId === cacheKey(row.origin)
                && cached.destinationPlaceId === cacheKey(row.destination)
                && (cached.source === "routes" || Date.now() - cached.computedAt.getTime() < GEOCODE_TTL_MS);

            if (cached && fresh) return toRouteDto(ref, cached);

            const failure = failureKey(row.id, row.origin, row.destination);

            if (failedRecently(failure)) {
                if (cached) return toRouteDto(ref, cached);
                throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ROUTE_UNAVAILABLE" });
            }

            const computed = await computeRoute(row.origin, row.destination);

            if (!computed) {
                rememberFailure(failure);
                if (cached) return toRouteDto(ref, cached);
                throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ROUTE_UNAVAILABLE" });
            }

            routeFailures.delete(failure);

            const values = {
                movementId: row.id,
                originPlaceId: cacheKey(row.origin),
                destinationPlaceId: cacheKey(row.destination),
                originLat: computed.origin.lat,
                originLng: computed.origin.lng,
                destinationLat: computed.destination.lat,
                destinationLng: computed.destination.lng,
                encodedPolyline: computed.encodedPolyline,
                distanceMeters: computed.distanceMeters,
                durationSeconds: computed.durationSeconds,
                source: computed.source,
                computedAt: new Date(),
            };

            const { movementId: _key, ...refresh } = values;

            const [saved] = await ctx.db
                .insert(movementRoute)
                .values(values)
                .onConflictDoUpdate({ target: movementRoute.movementId, set: refresh })
                .returning();

            if (!saved) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });

            return toRouteDto(ref, saved);
        }),

    /**
     * Asks the driver where they are, now, outside the twice-daily rounds —
     * the owner's own driver, or the off-platform partner's it was given.
     * Never a linked load's: that driver is the executor's to ask.
     *
     * Metered, like it always was: nothing ties a typed phone number to the
     * tenant that typed it, so an unbounded button here is a billed WhatsApp
     * send from Appload's sender to any number somebody cares to name.
     */
    requestLocation: tenantProcedure
        .input(z.object({ id: z.string().nonempty() }))
        .mutation(async ({ ctx, input }): Promise<{ sent: boolean; mode: "native" | "template" }> => {
            const tenantId = ctx.tenant.organizationId;
            const row = await loadOwn(ctx.db, input.id, tenantId);
            assertCan(ctx.tenant.role, "trip", "update");

            if (row.status !== "in-transit" || row.executionMovementId) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "NOT_TRACKABLE" });
            }

            const { driverName, driverPhone } = row;
            if (!driverName || !driverPhone) throw new TRPCError({ code: "BAD_REQUEST", message: "NO_DRIVER" });

            // Per load first, so one impatient user cannot spend the whole
            // company's budget on a single driver, then per company
            const allowed =
                await withinRateLimit(ctx.db, { key: `trip-ping:trip:${row.id}`, windowMs: 60 * 60 * 1000, max: 3 })
                && await withinRateLimit(ctx.db, { key: `trip-ping:org:${tenantId}`, windowMs: 24 * 60 * 60 * 1000, max: 30 });

            if (!allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "RATE_LIMITED" });

            // No order id: chats point at orders, never at movements — the
            // movement holds the link, which keeps the import one-way
            const { conversation } = await startConversation(ctx.db, { driverName, driverPhone });

            if (row.conversationId !== conversation.id) {
                await ctx.db
                    .update(movement)
                    .set({ conversationId: conversation.id })
                    .where(and(eq(movement.id, row.id), eq(movement.organizationId, tenantId)));
            }

            const ref = movementRef(row.seq, row.execution);
            const origin = place(row.origin);
            const destination = place(row.destination);
            const open = await hasOpenSession(ctx.db, conversation.id);

            const body = open
                ? locationRequestText(ref, { truckPlate: row.truckPlate, origin, destination })
                : trackingTemplateText(driverName, ref, row.truckPlate ?? "—", origin, destination);

            const result = open
                ? await sendWhatsAppLocationRequest(conversation.driverPhone, body)
                : await sendWhatsAppTemplate(
                    conversation.driverPhone,
                    [driverName, ref, row.truckPlate ?? "—", origin, destination],
                    shareLocationPayload(ref),
                );

            if (!result.ok) console.error("movement location request failed:", result.error);

            const [message] = await ctx.db
                .insert(chatMessage)
                .values({
                    conversationId: conversation.id,
                    direction: "outbound",
                    body,
                    status: result.ok ? "sent" : "failed",
                    externalId: result.ok ? result.externalId : null,
                })
                .returning({ createdAt: chatMessage.createdAt });

            if (message) {
                await ctx.db
                    .update(chatConversation)
                    .set({ lastMessageAt: message.createdAt })
                    .where(eq(chatConversation.id, conversation.id));
            }

            if (!result.ok && result.error === "INFOBIP_NOT_CONFIGURED") {
                throw new TRPCError({ code: "BAD_GATEWAY", message: "INFOBIP_NOT_CONFIGURED" });
            }

            return { sent: result.ok, mode: open ? "native" : "template" };
        }),
});
