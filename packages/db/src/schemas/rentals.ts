import { sql } from "drizzle-orm";
import { check, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Direct module imports, never the schema barrel (TDZ)
import { chatConversation, TRACKING_CHANNEL, TRACKING_STATUS } from "@workspace/db/chats";
import { contract, contractAllocation } from "@workspace/db/contracts";
import { currencyEnum } from "@workspace/db/orders";
import { servicePolicy, staffPolicy, throughAllocation, throughContract } from "@workspace/db/rls";
import { organization, user } from "@workspace/db/users";

/**
 * A rental is a `contract` with `basis: days`: trucks at a client's service
 * for a period, billed by the day. Each truck is a `contract_allocation`
 * line with the rig pinned. What is new here is the three things a rental
 * has and a trip does not: which days count, a payment that is not tied to
 * a trip, and the driver's daily answer.
 *
 * Billing is never stored. The whole period is billed unless a day is
 * marked (Claire, 2026-10-01): `rental_day` holds the exceptions and the
 * answers, and the amount is recomputed from the period, the mode and the
 * log on every read (domain rentals/billing.ts).
 */

/** How a day of a rental line counts: absent = worked. */
export const RENTAL_DAY_STATE = ["worked", "standby", "stopped", "off"] as const;
export type RentalDayState = (typeof RENTAL_DAY_STATE)[number];

export const DRIVER_ANSWER = ["yes", "no"] as const;
export type DriverAnswer = (typeof DRIVER_ANSWER)[number];

export const rentalDay = pgTable(
    "rental_day",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        allocationId: text("allocation_id")
            .notNull()
            .references(() => contractAllocation.id, { onDelete: "cascade" }),
        // Maputo calendar day, "YYYY-MM-DD"
        day: date("day", { mode: "string" }).notNull(),
        state: text("state", { enum: RENTAL_DAY_STATE }).default("worked").notNull(),
        note: text("note"),
        recordedBy: text("recorded_by").references(() => user.id, { onDelete: "set null" }),
        recordedOrgId: text("recorded_org_id").references(() => organization.id, { onDelete: "set null" }),
        // The driver's morning answer, when the check-in reached him
        driverAnswer: text("driver_answer", { enum: DRIVER_ANSWER }),
        answeredAt: timestamp("answered_at"),
        // The client disagrees with how the day counts; shows on both sides until settled
        disputedAt: timestamp("disputed_at"),
        disputedBy: text("disputed_by").references(() => user.id, { onDelete: "set null" }),
        disputeNote: text("dispute_note"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    },
    (table) => [
        uniqueIndex("rental_day_line_day_uidx").on(table.allocationId, table.day),
        staffPolicy("rental_day", throughAllocation(table.allocationId)),
        // The webhook files the driver's answer
        servicePolicy("rental_day"),
    ],
);

export type RentalDay = typeof rentalDay.$inferSelect;
export type CreateRentalDay = typeof rentalDay.$inferInsert;

/**
 * One morning question to one line's driver — the rental's own tracking
 * request, with the same chain and statuses as a load's (chats.ts).
 */
export const rentalCheckinRequest = pgTable(
    "rental_checkin_request",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        allocationId: text("allocation_id")
            .notNull()
            .references(() => contractAllocation.id, { onDelete: "cascade" }),
        conversationId: text("conversation_id").references(() => chatConversation.id, { onDelete: "set null" }),
        day: date("day", { mode: "string" }).notNull(),
        attempt: integer("attempt").notNull(),
        channel: text("channel", { enum: TRACKING_CHANNEL }).notNull(),
        status: text("status", { enum: TRACKING_STATUS }).default("pending").notNull(),
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
        uniqueIndex("rental_checkin_request_attempt_uidx").on(table.allocationId, table.day, table.attempt),
        index("rental_checkin_request_external_idx").on(table.externalId),
        staffPolicy("rental_checkin_request", throughAllocation(table.allocationId)),
        servicePolicy("rental_checkin_request"),
    ],
);

export type RentalCheckinRequest = typeof rentalCheckinRequest.$inferSelect;

export const PAYMENT_LEG = ["sell", "buy"] as const;
export type PaymentLeg = (typeof PAYMENT_LEG)[number];

/**
 * Money that moved against a rental: what the client paid the owner
 * (`sell`), what the owner paid a line's provider (`buy`, on that line). A
 * payment typed wrong is taken back by a negative line with a reference,
 * never edited — the same rule as a trip's payments.
 */
export const contractPayment = pgTable(
    "contract_payment",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        contractId: text("contract_id")
            .notNull()
            .references(() => contract.id, { onDelete: "cascade" }),
        allocationId: text("allocation_id").references(() => contractAllocation.id, { onDelete: "set null" }),
        leg: text("leg", { enum: PAYMENT_LEG }).notNull(),
        amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
        currency: currencyEnum("currency").notNull(),
        paidAt: timestamp("paid_at").notNull(),
        reference: text("reference"),
        recordedBy: text("recorded_by").references(() => user.id, { onDelete: "set null" }),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        index("contract_payment_contract_idx").on(table.contractId, table.paidAt),
        staffPolicy("contract_payment", throughContract(table.contractId)),
        // Zero moves nothing
        check("contract_payment_amount_ck", sql`${table.amount} <> 0`),
    ],
);

export type ContractPayment = typeof contractPayment.$inferSelect;
