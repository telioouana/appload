import { boolean, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Direct module imports, never the schema barrel: going through it would pull
// in modules that depend on this one and crash at runtime (TDZ)
import { Location, currencyEnum, fiscalRegimeEnum, loadingBayEnum, order, routeTypeEnum, weightUnitEnum } from "@workspace/db/orders";
import { organization, user } from "@workspace/db/users";

/** Lifecycle of a client's request for a quote — see `orderRequest.status`. */
export const ORDER_REQUEST_STATUS = ["requested", "quoted", "declined", "withdrawn", "closed"] as const;
export type OrderRequestStatus = (typeof ORDER_REQUEST_STATUS)[number];

/**
 * A client sending one of its connected carriers an order to quote (an RFQ).
 * The order itself is the shared `order` row in its "prospect" status; this
 * table is only who was asked and what came of it, so the same order can go
 * to several carriers at once and each of them answers with an `order_offer`.
 *
 * One row per (order, carrier): asking the same carrier twice updates the
 * existing row rather than stacking requests. The order FK is `cascade` —
 * a request carries no money of its own and has no meaning without its
 * order, like the offers it collects.
 */
export const orderRequest = pgTable(
    "order_request",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        orderId: text("order_id")
            .notNull()
            .references(() => order.id, { onDelete: "cascade" }),
        carrierOrgId: text("carrier_org_id")
            .notNull()
            .references(() => organization.id),
        status: text("status", { enum: ORDER_REQUEST_STATUS }).default("requested").notNull(),
        // Free text the client attached for this carrier
        message: text("message"),
        createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
        respondedAt: timestamp("responded_at"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    },
    (table) => [
        uniqueIndex("order_request_order_carrier_uidx").on(table.orderId, table.carrierOrgId),
        index("order_request_carrier_status_idx").on(table.carrierOrgId, table.status),
    ],
);

export type OrderRequest = typeof orderRequest.$inferSelect;
export type CreateOrderRequest = typeof orderRequest.$inferInsert;

/** Lifecycle of a standing quote — see `quote.status`. */
export const QUOTE_STATUS = ["sent", "accepted", "declined", "withdrawn", "expired"] as const;
export type QuoteStatus = (typeof QUOTE_STATUS)[number];

/**
 * A carrier's unsolicited standing quote to a connected client: a lane, a
 * price and a validity date, offered before any order exists. The mirror
 * image of `order_request` — there the client asks first, here the carrier
 * does.
 *
 * Accepting one creates the order and its accepted `order_offer`; `orderId`
 * is filled at that moment and is `set null` so the quote survives as the
 * record of what was offered even if the order it produced is removed. The
 * money block mirrors `order_offer` (VAT-inclusive totals, same convention as
 * the order's own amounts).
 */
export const quote = pgTable(
    "quote",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        carrierOrgId: text("carrier_org_id")
            .notNull()
            .references(() => organization.id),
        clientOrgId: text("client_org_id")
            .notNull()
            .references(() => organization.id),
        origin: jsonb("origin").$type<Location>().notNull(),
        destination: jsonb("destination").$type<Location>().notNull(),
        loadingDate: timestamp("loading_date"),
        route: routeTypeEnum("route").default("national").notNull(),
        loadingBay: loadingBayEnum("loading_bay"),
        // How much the carrier is offering to move on this lane
        capacityWeight: numeric("capacity_weight", { precision: 10, scale: 3 }),
        capacityUnit: weightUnitEnum("capacity_unit"),
        fiscalRegime: fiscalRegimeEnum("fiscal_regime").notNull(),
        subtotal: numeric("subtotal", { precision: 14, scale: 2 }),
        vat: numeric("vat", { precision: 14, scale: 2 }),
        total: numeric("total", { precision: 14, scale: 2 }).notNull(),
        currency: currencyEnum("currency").notNull(),
        // What the quoted price covers
        includesGit: boolean("includes_git").default(false).notNull(),
        includesGps: boolean("includes_gps").default(false).notNull(),
        notes: text("notes"),
        validUntil: timestamp("valid_until"),
        status: text("status", { enum: QUOTE_STATUS }).default("sent").notNull(),
        // Filled when accepted: the order the quote became
        orderId: text("order_id").references(() => order.id, { onDelete: "set null" }),
        createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
        decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
        decidedAt: timestamp("decided_at"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    },
    (table) => [
        index("quote_client_status_idx").on(table.clientOrgId, table.status),
        index("quote_carrier_status_idx").on(table.carrierOrgId, table.status),
    ],
);

export type Quote = typeof quote.$inferSelect;
export type CreateQuote = typeof quote.$inferInsert;
