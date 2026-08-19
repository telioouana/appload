import { check, index, pgTable, text, timestamp, boolean, integer, numeric, uniqueIndex, serial, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Direct module imports, never the schema barrel: going through it would pull
// in modules that depend on this one and crash at runtime (TDZ)
import { user, organization } from "@workspace/db/users";
import { driver, link, trailer, truck } from "@workspace/db/fleet";
import { CATEGORIES, CURRENCY, FISCAL_REGIME, INSURANCE_PAYMENT_STATUS, LOAD_TYPE, LOADING_BAY, ORDER_STATUS, PACKING, PAYMENT_STATUS, POD_STATUS, ROUTE_TYPE, TRIP_TYPE, TRUCK_AGE, WEIGHT_UNIT, } from "@workspace/db/types";

export const packingEnum = pgEnum("packing_enum", PACKING)
export const currencyEnum = pgEnum("currency_enum", CURRENCY)
export const loadTypeEnum = pgEnum("load_type_enum", LOAD_TYPE)
export const tripTypeEnum = pgEnum("trip_type_enum", TRIP_TYPE)
export const truckAgeEnum = pgEnum("truck_age_enum", TRUCK_AGE)
export const podStatusEnum = pgEnum("pod_status_enum", POD_STATUS)
export const routeTypeEnum = pgEnum("route_type_enum", ROUTE_TYPE)
export const categoriesEnum = pgEnum("categories_enum", CATEGORIES)
export const loadingBayEnum = pgEnum("loading_bay_enum", LOADING_BAY)
export const weightUnitEnum = pgEnum("weight_unit_enum", WEIGHT_UNIT)
export const orderStatusEnum = pgEnum("order_status_enum", ORDER_STATUS)
export const fiscalRegimeEnum = pgEnum("fiscal_regime_enum", FISCAL_REGIME)
export const paymentStatusEnum = pgEnum("payment_status_enum", PAYMENT_STATUS)
export const insurancePaymentStatusEnum = pgEnum("insurance_payment_status_enum", INSURANCE_PAYMENT_STATUS)

// Shape stored in the jsonb address columns. Must be declared here: without
// it, $type<Location> silently resolves to the DOM's window.location interface
export type Location = {
    address: string;
    placeId: string;
    country: string;
    state: string;
};

export const order = pgTable(
    "order",
    {
        id: text("id").primaryKey().$default(() => crypto.randomUUID()),
        legacyId: serial("legacy_id").unique().notNull(),
        // Human-facing id, e.g. "APPL021.26"
        orderId: text("order_id").notNull().unique(),
        seq: integer("seq").notNull(),
        year: integer("year").notNull(),

        shipperName: text("shipper_name").notNull(),
        shipperId: text("shipper_id").notNull().references(() => organization.id),

        loadingAddress: jsonb("loading_address").$type<Location>().notNull(),
        expectedLoadingDate: timestamp("expected_loading_date").notNull(),
        proposedLoadingDate: timestamp("proposed_loading_date"),
        arrivalAtLoading: timestamp("arrival_at_loading"),
        arrivalOnTimeLoading: boolean("arrival_ontime_loading"),
        actualLoadingDate: timestamp("actual_loading_date"),
        daysSpendNotLoading: integer("days_spend_not_loading"),
        departureLoadingDate: timestamp("departure_loading_date"),
        daysSpendLoading: integer("days_spend_loading"),
        demurrageAtLoading: boolean("demurrage_at_loading").default(false),
        demurrageChargedAtLoading: boolean("demurrage_charged_at_loading").default(false),
        demurrageChargedDaysAtLoading: integer("demurrage_charge_days_at_loading").default(0),

        offloadingAddress: jsonb("offloading_address").$type<Location>().notNull(),
        expectedOffloadingDate: timestamp("expected_offloading_date"),
        proposedOffloadingDate: timestamp("proposed_offloading_date"),
        arrivalAtOffloading: timestamp("arrival_at_offloading"),
        arrivalOnTimeOffloading: boolean("arrival_ontime_offloading"),
        actualOffloadingDate: timestamp("actual_offloading_date"),
        daysSpendNotOffloading: integer("days_spend_not_offloading"),
        departureOffloadingDate: timestamp("departure_offloading_date"),
        daysSpendOffloading: integer("days_spend_offloading"),
        demurrageAtOffloading: boolean("demurrage_at_offloading").default(false),
        demurrageChargedAtOffloading: boolean("demurrage_charged_at_offloading").default(false),
        demurrageChargedDaysAtOffloading: integer("demurrage_charge_days_at_offloading").default(0),

        arrivalAtBorder: timestamp("arrival_at_border"),
        departureFromBorder: timestamp("departure_from_border"),
        daysSpendAtBorder: integer("days_spend_at_border"),
        demurrageAtBorder: boolean("demurrage_at_border").default(false),
        demurrageChargedAtBorder: boolean("demurrage_charged_at_border").default(false),
        demurrageChargedDaysAtBorder: integer("demurrage_charge_days_at_border").default(0),

        distance: integer("distance"),
        daysSpendTraveling: integer("days_spend_traveling"),
        expectedTrucks: integer("expected_trucks").default(1),

        category: categoriesEnum("category").notNull(),
        description: text("description").notNull(),
        weight: numeric("weight", { precision: 10, scale: 3 }).notNull(),
        loadedWeight: numeric("loaded_weight", { precision: 10, scale: 3 }),
        offloadedWeight: numeric("offloaded_weight", { precision: 10, scale: 3 }),
        weightUnit: weightUnitEnum("weight_unit").default("ton").notNull(),
        packing: packingEnum("packing"),
        isHazardous: boolean("is_hazardous").default(false),
        hazchemCode: text("hazchem_code"),
        isRefrigerated: boolean("is_refrigerated").default(false),
        temperature: numeric("temperature", { precision: 10, scale: 2 }),
        temperatureInstructions: text("temperature_instructions"),

        status: orderStatusEnum("status").notNull(),
        route: routeTypeEnum("route").default("national").notNull(),
        tripType: tripTypeEnum("trip_type").default("normal").notNull(),
        loadType: loadTypeEnum("load_type").notNull(),
        deliveries: integer("deliveries").default(1),
        podStatus: podStatusEnum("pod_status"),
        
        carrierName: text("carrier_name"),
        carrierId: text("carrier_id").references(() => organization.id),

        driverName: text("driver_name"),
        driverId: text("driver_id").references(() => driver.id),
        driverPassport: text("driver_passport"),
        driverPhoneNumber: text("driver_phone_number"),
        // Plates come from the carrier's registered fleet (picked or
        // registered inline in the order form), enforced by these FKs
        truckPlate: text("truck_plate").references(() => truck.regPlate),
        trailerPlate: text("trailer_plate").references(() => trailer.regPlate),
        linkPlate: text("link_plate").references(() => link.regPlate),
        truckAge: truckAgeEnum("truck_age"),
        
        dealDate: timestamp("deal_date"),

        carrierInvoiceNumber: text("carrier_invoice_number"),
        carrierInvoiceDate: timestamp("carrier_invoice_date"),
        fiscalRegime: fiscalRegimeEnum("fiscal_regime"),
        carrierSubtotal: numeric("carrier_subtotal", { precision: 14, scale: 2 }),
        carrierVAT: numeric("carrier_vat", { precision: 14, scale: 2 }),
        carrierTotal: numeric("carrier_total", { precision: 14, scale: 2 }),
        carrierCurrency: currencyEnum("carrier_currency").default("MZN"),
        carrierPaidAmount: numeric("carrier_paid_amount", { precision: 14, scale: 2 }),
        carrierPaidPercentage: numeric("carrier_paid_percentage", { precision: 10, scale: 2 }),
        carrierPaymentStatus: paymentStatusEnum("carrier_payment_status"),
        carrierRemainingAmount: numeric("carrier_remaining_amount", { precision: 14, scale: 2 }),
        carrierRemainingPercentage: numeric("carrier_remaining_percentage", { precision: 10, scale: 2 }),
        carrierFullPaymentDate: timestamp("carrier_full_payment_date"),

        insuranceSubscriber: text("insurance_subscriber"),
        insuranceValue: numeric("insurance_value", { precision: 14, scale: 2 }),
        insuranceCurrency: currencyEnum("insurance_currency"),
        insuranceStatus: insurancePaymentStatusEnum("insurance_status"),

        apploadCommissionSubtotal: numeric("appload_commission_subtotal", { precision: 14, scale: 2 }),
        apploadCommissionVAT: numeric("appload_commission_vat", { precision: 14, scale: 2 }),
        apploadCommissionTotal: numeric("appload_commission_total", { precision: 14, scale: 2 }),

        // Live sums of the order's debit/credit notes per party, rebuildable
        // from order_document (sum of live note totals by type). Kept apart
        // from the base totals so those stay canonical:
        //   effective total   = base + debit − credit
        //   effective commission uses debit only (credit notes never touch
        //   Appload's commission — business rule)
        shipperDebitTotal: numeric("shipper_debit_total", { precision: 14, scale: 2 }).default("0").notNull(),
        shipperCreditTotal: numeric("shipper_credit_total", { precision: 14, scale: 2 }).default("0").notNull(),
        carrierDebitTotal: numeric("carrier_debit_total", { precision: 14, scale: 2 }).default("0").notNull(),
        carrierCreditTotal: numeric("carrier_credit_total", { precision: 14, scale: 2 }).default("0").notNull(),

        shipperInvoiceNumber: text("shipper_invoice_number"),
        shipperInvoiceDate: timestamp("shipper_invoice_date"),
        shipperSubtotal: numeric("shipper_subtotal", { precision: 14, scale: 2 }),
        shipperVAT: numeric("shipper_vat", { precision: 14, scale: 2 }),
        shipperTotal: numeric("shipper_total", { precision: 14, scale: 2 }),
        shipperCurrency: currencyEnum("shipper_currency").default("MZN"),
        // Read from Appload's side: the shipper leg is money RECEIVED, the
        // carrier leg (above) money PAID — the column names say so
        shipperReceivedAmount: numeric("shipper_received_amount", { precision: 14, scale: 2 }),
        shipperReceivedPercentage: numeric("shipper_received_percentage", { precision: 10, scale: 2 }),
        shipperPaymentStatus: paymentStatusEnum("shipper_payment_status"),
        shipperRemainingAmount: numeric("shipper_remaining_amount", { precision: 14, scale: 2 }),
        shipperRemainingPercentage: numeric("shipper_remaining_percentage", { precision: 10, scale: 2 }),
        shipperFullPaymentDate: timestamp("shipper_full_payment_date"),

        numberOfMechanicalFailuresStops: integer("number_mechanical_failures_stops").default(0),
        totalMechanicalFailuresDelayedDays: integer("total_mechanical_failures_delayed_days"),
        numberOfDocumentationIssuesStops: integer("number_documentation_issues_stops").default(0),
        totalDocumentationIssuesDelayedDays: integer("total_documentation_issues_delayed_days"),
        numberOfPoliceStops: integer("number_police_stops").default(0),
        totalPoliceDelayedDays: integer("total_police_delayed_days"),

        numberAccidents: integer("number_accidents").default(0),
        cargoDamaged: boolean("cargo_damaged").default(false),
        damagedPercent: numeric("damaged_percent"),
        claimed: boolean("claimed").default(false),

        ageFactor: numeric("age_factor"),
        loadFactor: numeric("load_factor"),
        defaultCoefficient: numeric("default_coefficient"),
        costPerKm: numeric("cost_per_km"),
        costPerUnit: numeric("cost_per_unit"),
        costPerUnitKm: numeric("cost_per_unit_km"),
        totalFuelCost: numeric("total_fuel_cost"),

        // Optimistic locking: every write goes through
        // `set version = version + 1 where id = ? and version = ?` — zero
        // affected rows means a concurrent writer won and the caller gets a
        // VERSION_CONFLICT instead of silently clobbering their fields
        version: integer("version").default(1).notNull(),

        // Review flag raised by risky transitions (backward moves, cancels
        // after cargo is committed, admin reversals). Not a status: the order
        // keeps operating while flagged; only order.resolveFlag clears it
        flaggedForReview: boolean("flagged_for_review").default(false).notNull(),
        flagReason: text("flag_reason"),
        flaggedAt: timestamp("flagged_at"),
        flaggedBy: text("flagged_by").references(() => user.id, { onDelete: "set null" }),

        createdBy: text("created_by").references(() => user.id),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    },
    // Single arbiter for concurrent Order Id generation
    (table) => [uniqueIndex("order_year_seq_idx").on(table.year, table.seq)],
);

export type Order = typeof order.$inferSelect
export type CreateOrder = typeof order.$inferInsert


// One row per meaningful order event. Kept as text + TS const (not a pg
// enum) so new kinds never need an ALTER TYPE on the shared database.
export const ORDER_HISTORY_KIND = [
    "transition",
    "update",
    "document",
    "note",
    "payment",
    "flag",
    "system",
] as const;

export type OrderHistoryKind = (typeof ORDER_HISTORY_KIND)[number];

// Sparse field-level diff captured on order.update — only the patched keys,
// long values truncated before storage.
export type ChangedFields = Record<string, { from: unknown; to: unknown }>;

/**
 * Append-only order event log — the audit trail behind the details-page
 * timeline and the resume-target derivation for interrupted orders.
 * Never updated, never deleted. Written in the same db.batch as the order
 * write it describes, so the trail can't drift from the row.
 */
export const orderHistory = pgTable(
    "order_history",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        // restrict: financial/logistical records are never hard-deleted, so
        // their history must never be orphaned either
        orderId: text("order_id").notNull().references(() => order.id, { onDelete: "restrict" }),
        // Null actor = system event (cron, webhook)
        actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
        kind: text("kind", { enum: ORDER_HISTORY_KIND }).notNull(),
        // Transition rows only; fromStatus null = order creation
        fromStatus: orderStatusEnum("from_status"),
        toStatus: orderStatusEnum("to_status"),
        changedFields: jsonb("changed_fields").$type<ChangedFields>(),
        // Free-form context: note text, flag reason, document id, cron slot...
        metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [index("order_history_order_created_idx").on(table.orderId, table.createdAt)],
);

export type OrderHistory = typeof orderHistory.$inferSelect
export type CreateOrderHistory = typeof orderHistory.$inferInsert


// One polymorphic table for everything attached to an order: PODs,
// invoices, debit/credit notes, proofs of payment, transition evidence,
// generated transport orders. Kept as text + TS const (not a pg enum) so
// new types never need an ALTER TYPE on the shared database.
export const ORDER_DOCUMENT_TYPE = [
    "pod",
    "shipper-invoice",
    "carrier-invoice",
    "debit-note",
    "credit-note",
    "proof-of-payment",
    "evidence",
    "transport-order",
    "other",
] as const;

export type OrderDocumentType = (typeof ORDER_DOCUMENT_TYPE)[number];

export const DOCUMENT_PARTY = ["shipper", "carrier"] as const;

export type DocumentParty = (typeof DOCUMENT_PARTY)[number];

// Why a debit/credit note was issued. Text + TS const so the list can grow
// without an ALTER TYPE; the note type (debit/credit) gives the direction,
// the code gives the cause. Only "demurrage" and "damage" carry details the
// order row is updated from — see NoteDetails.
export const NOTE_REASON = [
    "demurrage",
    "damage",
    "loss-shortage",
    "late-delivery",
    "extra-delivery",
    "route-deviation",
    "waiting-time",
    "tolls-fees",
    "fuel-surcharge",
    "handling",
    "storage",
    "cleaning",
    "escort-security",
    "cancellation",
    "weight-variance",
    "rate-correction",
    "duplicate-invoice",
    "discount",
    "currency-adjustment",
    "tax-adjustment",
    "insurance",
    "extra-expenses",
    "other",
] as const;

export type NoteReason = (typeof NOTE_REASON)[number];

export const DEMURRAGE_STAGE = ["loading", "offloading", "border"] as const;

export type DemurrageStage = (typeof DEMURRAGE_STAGE)[number];

/**
 * Reason-specific particulars of a note. Demurrage: which stage and how many
 * days were charged (both required — they set the order's demurrage-charged
 * columns). Damage: optional damaged share and claim flag (they set the
 * order's cargo-damage columns).
 */
export type NoteDetails = {
    stage?: DemurrageStage;
    days?: number;
    damagedPercent?: number;
    claimed?: boolean;
};

/**
 * Order documents, financial notes and proofs of payment. Financial/
 * logistical records are never hard-deleted: rows soft-delete via
 * deletedAt/deletedBy and the blob stays in storage for audit.
 * Debit/credit notes carry the money block; their live sums are
 * materialized on the order row (shipper/carrier debit/credit totals) and
 * rebuildable from here. Proofs of payment reuse the same block (`total`
 * = amount paid, `reason` = reference) plus `paidAt`; a party leg that has
 * ever had one derives its paid columns from the live proofs.
 */
export const orderDocument = pgTable(
    "order_document",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        orderId: text("order_id").notNull().references(() => order.id, { onDelete: "restrict" }),
        type: text("type", { enum: ORDER_DOCUMENT_TYPE }).notNull(),
        // Which side of the deal the document belongs to; null = order-level
        // (pod, evidence)
        party: text("party", { enum: DOCUMENT_PARTY }),
        title: text("title"),
        url: text("url").notNull(),
        size: integer("size"),
        mimeType: text("mime_type"),

        // Debit/credit note money block — VAT-inclusive totals, same
        // convention as the order's own amounts. For a proof of payment,
        // `total` is the amount paid and `reason` the bank reference/notes.
        subtotal: numeric("subtotal", { precision: 14, scale: 2 }),
        vat: numeric("vat", { precision: 14, scale: 2 }),
        total: numeric("total", { precision: 14, scale: 2 }),
        currency: currencyEnum("currency"),
        // Notes: free-text description (legacy rows: the whole reason);
        // proofs of payment: bank reference; invoices: the invoice number
        reason: text("reason"),
        // Notes: the structured cause (NOTE_REASON) and its particulars.
        // Nullable so notes recorded before the vocabulary existed keep
        // only their free text.
        reasonCode: text("reason_code", { enum: NOTE_REASON }),
        details: jsonb("details").$type<NoteDetails>(),
        // Proof of payment: bank value date (required for proof-of-payment
        // rows by the CHECK below)
        paidAt: timestamp("paid_at"),

        uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
        deletedAt: timestamp("deleted_at"),
        deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        index("order_document_order_type_idx").on(table.orderId, table.type),
        // A note or proof of payment without a party or a total cannot
        // adjust anything; a proof of payment also needs its payment date
        check(
            "order_document_note_fields_chk",
            sql`(${table.type} not in ('debit-note', 'credit-note', 'proof-of-payment') or (${table.party} is not null and ${table.total} is not null)) and (${table.type} <> 'proof-of-payment' or ${table.paidAt} is not null)`,
        ),
    ],
);

export type OrderDocument = typeof orderDocument.$inferSelect
export type CreateOrderDocument = typeof orderDocument.$inferInsert


export const SHEET_SYNC_STATE = ["pending", "done", "failed"] as const;
export type SheetSyncState = (typeof SHEET_SYNC_STATE)[number];

/**
 * Outbox for the Google Sheets sync. Mutations mark the order pending and
 * push post-response (ctx.waitUntil); the retry cron sweeps pending/failed
 * rows with the service-account token. One row per order — the sheet only
 * ever needs the latest state, so retries collapse naturally.
 */
export const sheetSync = pgTable("sheet_sync", {
    orderId: text("order_id").primaryKey().references(() => order.id, { onDelete: "restrict" }),
    state: text("state", { enum: SHEET_SYNC_STATE }).default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .$onUpdate(() => /* @__PURE__ */ new Date())
        .notNull(),
});

export type SheetSync = typeof sheetSync.$inferSelect;
export type CreateSheetSync = typeof sheetSync.$inferInsert;