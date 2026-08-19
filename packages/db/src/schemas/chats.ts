import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { order } from "@workspace/db/orders";

export const MESSAGE_DIRECTION = ["inbound", "outbound"] as const;
export const MESSAGE_STATUS = ["pending", "sent", "delivered", "read", "failed"] as const;

// One conversation per driver phone number (the Infobip channel identity)
export const chatConversation = pgTable(
    "chat_conversation",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        driverName: text("driver_name").notNull(),
        driverPhone: text("driver_phone").notNull().unique(),
        // Optional link to the order this conversation is about (human id,
        // e.g. "APPL021.26"), so chat updates can be applied to the order
        orderId: text("order_id").references(() => order.orderId),
        lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    },
);

export const chatMessage = pgTable(
    "chat_message",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        conversationId: text("conversation_id")
            .notNull()
            .references(() => chatConversation.id, { onDelete: "cascade" }),
        direction: text("direction", { enum: MESSAGE_DIRECTION }).notNull(),
        body: text("body").notNull(),
        // Delivery lifecycle for outbound messages; null for inbound
        status: text("status", { enum: MESSAGE_STATUS }),
        // Infobip message id, set once the platform is connected
        externalId: text("external_id"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [index("chat_message_conversation_idx").on(table.conversationId, table.createdAt)],
);

export type ChatConversation = typeof chatConversation.$inferSelect;
export type CreateChatConversation = typeof chatConversation.$inferInsert;
export type ChatMessage = typeof chatMessage.$inferSelect;
export type CreateChatMessage = typeof chatMessage.$inferInsert;


export const TRACKING_CHANNEL = ["whatsapp", "sms"] as const;
export type TrackingChannel = (typeof TRACKING_CHANNEL)[number];

export const TRACKING_STATUS = ["pending", "sent", "delivered", "responded", "failed", "skipped"] as const;
export type TrackingStatus = (typeof TRACKING_STATUS)[number];

export const TRACKING_SLOT = ["morning", "afternoon"] as const;
export type TrackingSlot = (typeof TRACKING_SLOT)[number];

/**
 * One row per driver location request the tracking cron sends: two slots a
 * day (08:00 / 17:00 Maputo), up to three attempts per slot — WhatsApp,
 * WhatsApp again after 30 minutes without a reply, then SMS after another
 * 30 minutes without a delivery receipt. Webhook delivery reports and
 * inbound replies update `status` by matching `externalId` / conversation.
 * All timestamps are UTC; the slot pair encodes the local business time.
 */
export const trackingRequest = pgTable(
    "tracking_request",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        orderId: text("order_id").notNull().references(() => order.id, { onDelete: "restrict" }),
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
        uniqueIndex("tracking_request_order_slot_attempt_uidx")
            .on(table.orderId, table.slotDate, table.slot, table.attempt),
        index("tracking_request_external_idx").on(table.externalId),
    ],
);

export type TrackingRequest = typeof trackingRequest.$inferSelect;
export type CreateTrackingRequest = typeof trackingRequest.$inferInsert;
