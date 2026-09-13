import { sql } from "drizzle-orm";
import { boolean, check, doublePrecision, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";

// Direct module imports, never the schema barrel: going through it would pull
// in modules that depend on this one and crash at runtime (TDZ)
import { TRACKING_CHANNEL, TRACKING_SLOT, TRACKING_STATUS, chatConversation, chatMessage } from "@workspace/db/chats";
import { driver, link, trailer, truck } from "@workspace/db/fleet";
import { Location, categoriesEnum, currencyEnum, fiscalRegimeEnum, paymentStatusEnum, routeTypeEnum, weightUnitEnum } from "@workspace/db/orders";
import { LOCATION_SOURCE, ROUTE_SOURCE } from "@workspace/db/tracking";
import { organization, user } from "@workspace/db/users";

/**
 * Who actually moves the load — the whole difference between what the portal
 * calls a Trip and what it calls an Order. "own-fleet" is the tenant's own
 * truck and driver; "partner" is a load it handed to somebody else for an
 * agreed price.
 */
export const MOVEMENT_EXECUTION = ["own-fleet", "partner"] as const;
export type MovementExecution = (typeof MOVEMENT_EXECUTION)[number];

/**
 * Where a movement is in its life. Deliberately not `order_status_enum`: that
 * is a sixteen-member pg enum shaped around Appload's own operations, and
 * extending it would mean an ALTER TYPE on a type the admin filters on.
 *
 * "procurement" is the first status — the load exists and nobody has
 * committed to moving it yet. On an Order that reads as sourcing a partner;
 * on a Trip it means no driver and truck are named yet, and the portal labels
 * it "planning" there from this same stored value.
 *
 * "offered" and "declined" are only reachable on a partner execution whose
 * executor can answer for itself on the portal. An off-platform partner has
 * nobody to click accept, so the owner goes straight to scheduled or
 * in-transit — see @workspace/domain/movements/status.
 *
 * "scheduled" is the load agreed; "booked" is the day, the truck and the
 * driver arranged for it. The portal labels them "Confirmed" and "Booked";
 * a Trip shows both as one step, since planning a trip is arranging it.
 */
export const MOVEMENT_STATUS = [
    "procurement",
    "offered",
    "declined",
    "scheduled",
    "booked",
    "in-transit",
    "delivered",
    "closed",
    "cancelled",
] as const;
export type MovementStatus = (typeof MOVEMENT_STATUS)[number];

/**
 * One load a portal tenant is responsible for, with no Appload order behind
 * it. Two shapes of the same thing, told apart by `execution`: the tenant's
 * own truck (a Trip) or somebody else's (an Order). One table because the two
 * differ by six columns out of forty, and because a Trip becomes an Order the
 * day a contract conflict forces a subcontract — that is a status of the same
 * load, not a different record, and it must keep its reference, its URL, its
 * trail and the costs already booked against it.
 *
 * These rows are the tenant's own books. They never reach the `order` table,
 * the Sheets logbook, Appload's KPIs or its commission, and the admin does
 * not list them. The only things they share with the brokerage are the
 * tracking machinery and the monthly tracked-movement allowance.
 *
 * `executionMovementId` is the cross-tenant seam: when the executor is a
 * portal tenant that accepted, THEIR movement is linked here and their
 * driver's pings are what this row's trail projects. Exactly one row in a
 * subcontract chain has a driver phone and no link — the truck — which is
 * what makes "the driver is asked once, by one company" a predicate rather
 * than a convention.
 */
export const movement = pgTable(
    "movement",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        // Display reference "TRP-<seq>" own-fleet, "ORD-<seq>" partner. One
        // sequence for both, so a conversion keeps the number it was known by
        seq: serial("seq").unique().notNull(),
        // The tenant whose books this row is in, client or carrier
        organizationId: text("organization_id")
            .notNull()
            .references(() => organization.id),
        execution: text("execution", { enum: MOVEMENT_EXECUTION }).default("own-fleet").notNull(),
        status: text("status", { enum: MOVEMENT_STATUS }).default("procurement").notNull(),

        // --- who it is for: the sell side ------------------------------------
        // An organization when the client is on the platform or was registered
        // as a shell company, free text when it is neither. One of the two is
        // what the UI shows; a shipper's own internal run has neither
        clientOrgId: text("client_org_id").references(() => organization.id),
        clientName: text("client_name"),
        // The client's own PO or contract number, so the invoice matches
        clientReference: text("client_reference"),

        // --- who moves it: the buy side, partner execution only ---------------
        carrierOrgId: text("carrier_org_id").references(() => organization.id),
        carrierName: text("carrier_name"),
        // The executor's own row, once they accepted on the portal. A self FK,
        // so a subcontract chain is a linked list inside this one table
        executionMovementId: text("execution_movement_id").references((): AnyPgColumn => movement.id, {
            onDelete: "set null",
        }),
        offeredAt: timestamp("offered_at"),
        respondedAt: timestamp("responded_at"),
        responseNote: text("response_note"),

        // --- driver and rig ----------------------------------------------------
        // All nullable: a movement in procurement has no driver yet, and a
        // partner-executed one may never learn who drove. Free text beside
        // optional fleet ids, so an off-platform truck and a registered one
        // live in the same columns
        driverName: text("driver_name"),
        // E.164, the WhatsApp channel identity
        driverPhone: text("driver_phone"),
        driverId: text("driver_id").references(() => driver.id, { onDelete: "set null" }),
        truckPlate: text("truck_plate"),
        truckId: text("truck_id").references(() => truck.id, { onDelete: "set null" }),
        trailerId: text("trailer_id").references(() => trailer.id, { onDelete: "set null" }),
        linkId: text("link_id").references(() => link.id, { onDelete: "set null" }),
        // Set on the first request or ping so the thread can be shown beside
        // the load; chats never point back at movements, which keeps the
        // import one-way and the schema free of a cycle
        conversationId: text("conversation_id").references(() => chatConversation.id, { onDelete: "set null" }),

        // --- route and cargo ----------------------------------------------------
        origin: jsonb("origin").$type<Location>().notNull(),
        destination: jsonb("destination").$type<Location>().notNull(),
        route: routeTypeEnum("route").default("national").notNull(),
        cargoDescription: text("cargo_description"),
        category: categoriesEnum("category"),
        weight: numeric("weight", { precision: 10, scale: 3 }),
        weightUnit: weightUnitEnum("weight_unit"),

        // --- dates ---------------------------------------------------------------
        expectedLoadingDate: timestamp("expected_loading_date"),
        startedAt: timestamp("started_at"),
        expectedDeliveryAt: timestamp("expected_delivery_at"),
        deliveredAt: timestamp("delivered_at"),
        closedAt: timestamp("closed_at"),

        trackingEnabled: boolean("tracking_enabled").default(true).notNull(),

        // --- sell leg: what I charge my client ------------------------------------
        // VAT-inclusive totals, the same convention the order and quote rows
        // use. Every amount carries its own currency: nothing in this repo is
        // ever summed across two of them
        sellSubtotal: numeric("sell_subtotal", { precision: 14, scale: 2 }),
        sellVat: numeric("sell_vat", { precision: 14, scale: 2 }),
        sellTotal: numeric("sell_total", { precision: 14, scale: 2 }),
        sellCurrency: currencyEnum("sell_currency"),
        sellFiscalRegime: fiscalRegimeEnum("sell_fiscal_regime"),
        sellInvoiceNumber: text("sell_invoice_number"),
        sellInvoiceDate: timestamp("sell_invoice_date"),
        sellSettlement: paymentStatusEnum("sell_settlement"),
        sellReceivedAmount: numeric("sell_received_amount", { precision: 14, scale: 2 }),
        sellSettledAt: timestamp("sell_settled_at"),

        // --- buy leg: what I pay the executor -------------------------------------
        buySubtotal: numeric("buy_subtotal", { precision: 14, scale: 2 }),
        buyVat: numeric("buy_vat", { precision: 14, scale: 2 }),
        buyTotal: numeric("buy_total", { precision: 14, scale: 2 }),
        buyCurrency: currencyEnum("buy_currency"),
        buyFiscalRegime: fiscalRegimeEnum("buy_fiscal_regime"),
        buyInvoiceNumber: text("buy_invoice_number"),
        buyInvoiceDate: timestamp("buy_invoice_date"),
        buySettlement: paymentStatusEnum("buy_settlement"),
        buyPaidAmount: numeric("buy_paid_amount", { precision: 14, scale: 2 }),
        buySettledAt: timestamp("buy_settled_at"),

        notes: text("notes"),
        // Optimistic lock, the same handshake the order row uses: two members
        // of one company editing the same load from two tabs
        version: integer("version").default(1).notNull(),
        createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    },
    (table) => [
        index("movement_organization_status_idx").on(table.organizationId, table.status),
        // The executor's inbox: what has been offered to this company
        index("movement_carrier_status_idx").on(table.carrierOrgId, table.status),
        index("movement_client_status_idx").on(table.clientOrgId, table.status),
        // The tracking cron's working set: who is on the road with nobody
        // downstream reporting for them. The link clause is the whole reason a
        // subcontracted driver is asked once instead of once per company
        index("movement_driver_phone_idx")
            .on(table.driverPhone)
            .where(sql`${table.status} = 'in-transit' and ${table.executionMovementId} is null`),
        // One executor movement answers at most one order: without this a
        // partner could point two of my orders at the same truck
        uniqueIndex("movement_execution_uidx")
            .on(table.executionMovementId)
            .where(sql`${table.executionMovementId} is not null`),
        check("movement_execution_self_ck", sql`${table.executionMovementId} is distinct from ${table.id}`),
        // An own-fleet movement has no buy side at all: the columns exist for
        // the other shape, and a stray figure in them would be read as a cost
        check(
            "movement_own_fleet_ck",
            sql`${table.execution} = 'partner' or (${table.carrierOrgId} is null and ${table.carrierName} is null and ${table.buyTotal} is null and ${table.executionMovementId} is null)`,
        ),
        // A figure without its currency cannot be added to anything
        check("movement_sell_currency_ck", sql`${table.sellTotal} is null or ${table.sellCurrency} is not null`),
        check("movement_buy_currency_ck", sql`${table.buyTotal} is null or ${table.buyCurrency} is not null`),
    ],
);

export type Movement = typeof movement.$inferSelect;
export type CreateMovement = typeof movement.$inferInsert;

/**
 * Cached Google result for a movement's origin → destination leg, one row per
 * movement. Same shape and same rules as `order_route` (tracking.ts):
 * "routes" carries the road polyline, "geocode" only the two endpoints; the
 * place ids are the cache key so an edited address recomputes the row.
 * Deleting the movement takes its route with it — nothing auditable lives
 * here, it is a derived cache.
 */
export const movementRoute = pgTable("movement_route", {
    movementId: text("movement_id")
        .primaryKey()
        .references(() => movement.id, { onDelete: "cascade" }),
    originPlaceId: text("origin_place_id").notNull(),
    destinationPlaceId: text("destination_place_id").notNull(),
    originLat: doublePrecision("origin_lat").notNull(),
    originLng: doublePrecision("origin_lng").notNull(),
    destinationLat: doublePrecision("destination_lat").notNull(),
    destinationLng: doublePrecision("destination_lng").notNull(),
    // Google's encoded polyline; null on "geocode" rows
    encodedPolyline: text("encoded_polyline"),
    distanceMeters: integer("distance_meters"),
    durationSeconds: integer("duration_seconds"),
    source: text("source", { enum: ROUTE_SOURCE }).notNull(),
    computedAt: timestamp("computed_at").defaultNow().notNull(),
});

export type MovementRoute = typeof movementRoute.$inferSelect;
export type CreateMovementRoute = typeof movementRoute.$inferInsert;

/**
 * Driver position pings that make up a movement's trail on the map — the
 * `order_location` shape (tracking.ts) keyed by movement. `chatMessageId` is
 * unique, so a replayed webhook never duplicates a ping; the movement FK is
 * `restrict` because pings are evidence of where the cargo went and are never
 * orphaned, while the conversation and message FKs are `set null` so a thread
 * can be cleaned up without losing the position it reported.
 *
 * The coordinates carry the same CHECK as the order trail: a ping is
 * permanent and shared, and one out-of-range row would frame the whole map
 * around it.
 */
export const movementLocation = pgTable(
    "movement_location",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        movementId: text("movement_id")
            .notNull()
            .references(() => movement.id, { onDelete: "restrict" }),
        conversationId: text("conversation_id").references(() => chatConversation.id, { onDelete: "set null" }),
        // One ping per chat message: the unique constraint is what makes the
        // webhook idempotent
        chatMessageId: text("chat_message_id")
            .unique()
            .references(() => chatMessage.id, { onDelete: "set null" }),
        latitude: doublePrecision("latitude").notNull(),
        longitude: doublePrecision("longitude").notNull(),
        // Label the driver's client attached to the location, when any
        placeName: text("place_name"),
        source: text("source", { enum: LOCATION_SOURCE }).default("whatsapp").notNull(),
        recordedAt: timestamp("recorded_at").defaultNow().notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        index("movement_location_movement_recorded_idx").on(table.movementId, table.recordedAt),
        check("movement_location_latlng_ck", sql`latitude between -90 and 90 and longitude between -180 and 180`),
    ],
);

export type MovementLocation = typeof movementLocation.$inferSelect;
export type CreateMovementLocation = typeof movementLocation.$inferInsert;

/**
 * One row per driver location request the portal's tracking cron sends for a
 * movement — the `tracking_request` shape (chats.ts) keyed by movement: two
 * slots a day (08:00 / 17:00 Maputo), up to three attempts per slot, WhatsApp
 * then SMS. The (movement, slotDate, slot, attempt) unique index is what makes
 * cron re-runs idempotent; `externalId` is the join key for delivery reports.
 * All timestamps are UTC; the slot pair encodes the local business time.
 */
export const movementTrackingRequest = pgTable(
    "movement_tracking_request",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        movementId: text("movement_id")
            .notNull()
            .references(() => movement.id, { onDelete: "restrict" }),
        conversationId: text("conversation_id").references(() => chatConversation.id, { onDelete: "set null" }),
        // Local Maputo calendar date, e.g. "2026-08-09" — with slot+attempt
        // it makes cron re-runs idempotent
        slotDate: text("slot_date").notNull(),
        slot: text("slot", { enum: TRACKING_SLOT }).notNull(),
        attempt: integer("attempt").notNull(),
        channel: text("channel", { enum: TRACKING_CHANNEL }).notNull(),
        status: text("status", { enum: TRACKING_STATUS }).default("pending").notNull(),
        // Infobip message id — the join key for delivery reports
        externalId: text("external_id"),
        error: text("error"),
        scheduledFor: timestamp("scheduled_for").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    },
    (table) => [
        uniqueIndex("movement_tracking_request_slot_attempt_uidx").on(
            table.movementId,
            table.slotDate,
            table.slot,
            table.attempt,
        ),
        index("movement_tracking_request_external_idx").on(table.externalId),
    ],
);

export type MovementTrackingRequest = typeof movementTrackingRequest.$inferSelect;
export type CreateMovementTrackingRequest = typeof movementTrackingRequest.$inferInsert;

/** What a cost line is for. Text + TS const so the list grows without an ALTER TYPE. */
export const MOVEMENT_COST_KIND = [
    "fuel",
    "tolls",
    "driver-allowance",
    "border-fees",
    "escort",
    "parking",
    "maintenance",
    "fine",
    "loading",
    "offloading",
    "insurance",
    "other",
] as const;
export type MovementCostKind = (typeof MOVEMENT_COST_KIND)[number];

/**
 * What one load actually cost to run, line by line. Only the movement's OWNER
 * ever reads these: a cost line is that company's own margin working, and the
 * partner on the other side has no business seeing it.
 *
 * Financial records, so the same rules as `order_document`: `restrict` on the
 * movement, and a soft delete rather than a row that disappears from a total
 * somebody already reconciled. Each line carries its own currency and the
 * sums come back per currency — nothing here is ever added across two.
 */
export const movementCost = pgTable(
    "movement_cost",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        movementId: text("movement_id")
            .notNull()
            .references(() => movement.id, { onDelete: "restrict" }),
        kind: text("kind", { enum: MOVEMENT_COST_KIND }).notNull(),
        description: text("description"),
        amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
        currency: currencyEnum("currency").notNull(),
        incurredAt: timestamp("incurred_at").defaultNow().notNull(),
        // Passed on to the client as an extra rather than absorbed: it leaves
        // the margin alone and belongs on the invoice instead
        rechargeable: boolean("rechargeable").default(false).notNull(),
        createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
        deletedAt: timestamp("deleted_at"),
        deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        index("movement_cost_movement_idx").on(table.movementId, table.incurredAt),
        check("movement_cost_amount_ck", sql`${table.amount} >= 0`),
    ],
);

export type MovementCost = typeof movementCost.$inferSelect;
export type CreateMovementCost = typeof movementCost.$inferInsert;

/**
 * What a paper attached to a load is. "loading-photo" is the odd one out: it
 * is not paperwork but the warehouse's own record of what went on the truck,
 * taken at loading and approved by somebody who answers for the load before
 * it leaves (see `approvedAt` below).
 */
export const MOVEMENT_DOCUMENT_TYPE = [
    "pod",
    "cmr",
    "invoice",
    "receipt",
    "evidence",
    "loading-photo",
    "transport-order",
    "other",
] as const;
export type MovementDocumentType = (typeof MOVEMENT_DOCUMENT_TYPE)[number];

/** Which side of the deal a paper belongs to; null is the load's own. */
export const MOVEMENT_DOCUMENT_LEG = ["sell", "buy"] as const;
export type MovementDocumentLeg = (typeof MOVEMENT_DOCUMENT_LEG)[number];

/**
 * Papers attached to a load. `leg` is what decides who may read one: a
 * sell-leg invoice is between the owner and its client, a buy-leg receipt
 * between the owner and its executor, and a POD (leg null) belongs to
 * everybody on the chain. Soft delete and `restrict`, like `order_document` —
 * a proof of delivery is not something that vanishes.
 */
export const movementDocument = pgTable(
    "movement_document",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        movementId: text("movement_id")
            .notNull()
            .references(() => movement.id, { onDelete: "restrict" }),
        type: text("type", { enum: MOVEMENT_DOCUMENT_TYPE }).notNull(),
        leg: text("leg", { enum: MOVEMENT_DOCUMENT_LEG }),
        title: text("title"),
        url: text("url").notNull(),
        size: integer("size"),
        mimeType: text("mime_type"),
        // The cost line this paper is the receipt for, when it is one
        costId: text("cost_id").references(() => movementCost.id, { onDelete: "set null" }),
        uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
        // Who validated a loading photo, and when. Null on everything else and
        // on a photo nobody has looked at yet — which is what raises
        // PHOTOS_UNAPPROVED on a load about to leave (status.ts)
        approvedAt: timestamp("approved_at"),
        approvedBy: text("approved_by").references(() => user.id, { onDelete: "set null" }),
        deletedAt: timestamp("deleted_at"),
        deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [index("movement_document_movement_idx").on(table.movementId, table.createdAt)],
);

export type MovementDocument = typeof movementDocument.$inferSelect;
export type CreateMovementDocument = typeof movementDocument.$inferInsert;

/** What an event row records — `kind` is also what the projection filters on. */
export const MOVEMENT_EVENT_KIND = [
    "status",
    "offer",
    "update",
    "money",
    "cost",
    "document",
    "note",
    "system",
] as const;
export type MovementEventKind = (typeof MOVEMENT_EVENT_KIND)[number];

/**
 * Append-only trail, the `order_history` idea at a tenth the size. It exists
 * because a movement can be shared by two companies: who accepted, who
 * cancelled a load that was already loading, and when. Never updated, never
 * deleted, written in the same batch as the row it describes.
 *
 * "money" and "cost" rows are the owner's alone — the projection drops them
 * for anybody else, which is why `kind` is a column and not a free string.
 */
export const movementEvent = pgTable(
    "movement_event",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        movementId: text("movement_id")
            .notNull()
            .references(() => movement.id, { onDelete: "restrict" }),
        actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
        // Null when nobody did it: a status propagated from the row below, or
        // a cron
        actorOrgId: text("actor_org_id").references(() => organization.id, { onDelete: "set null" }),
        kind: text("kind", { enum: MOVEMENT_EVENT_KIND }).notNull(),
        fromStatus: text("from_status", { enum: MOVEMENT_STATUS }),
        toStatus: text("to_status", { enum: MOVEMENT_STATUS }),
        note: text("note"),
        metadata: jsonb("metadata"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [index("movement_event_movement_idx").on(table.movementId, table.createdAt)],
);

export type MovementEvent = typeof movementEvent.$inferSelect;
export type CreateMovementEvent = typeof movementEvent.$inferInsert;
