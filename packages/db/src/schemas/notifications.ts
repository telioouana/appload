import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Direct module imports, never the schema barrel: going through it would pull
// in modules that depend on this one and crash at runtime (TDZ)
import { organization, user } from "@workspace/db/users";

// What happened. Kept as text + TS const (not a pg enum) so new kinds never
// need an ALTER TYPE on the shared database.
export const NOTIFICATION_KIND = [
    "connection.requested",
    "connection.accepted",
    "connection.declined",
    "connection.removed",
    "claim.approved",
    "member.joined",
    "order.requested",
    "order.quoted",
    "order.booked",
    "order.status",
    "order.cancelled",
    "order.document",
    "quote.received",
    "quote.accepted",
    "quote.declined",
    "quote.withdrawn",
    "movement.offered",
    "movement.accepted",
    "movement.declined",
    "movement.started",
    "movement.delivered",
    "movement.cancelled",
    "movement.withdrawn",
    "movement.location-alert",
    "movement.document",
    "movement.dispute-opened",
    "movement.dispute-resolved",
    "subscription.changed",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KIND)[number];

/**
 * Where the notification's email is in its own lifecycle — see
 * `notification.emailState`. "sending" is the outbox worker's claim: a row it
 * has taken out of the queue and not yet settled, which is what keeps two
 * overlapping runs from sending the same email twice.
 */
export const EMAIL_STATE = ["none", "pending", "sending", "sent", "failed"] as const;
export type EmailState = (typeof EMAIL_STATE)[number];

// Display-safe values only, same rule as activity_log's params
export type NotificationParams = Record<string, string | number | boolean | null>;

/**
 * One row per member per event: the portal's notification centre fans an
 * event out to every member of the organization it concerns, so each of them
 * carries their own read state. `params` holds the display values the message
 * is rendered from (scalars only, like the activity log), and
 * `entityType`/`entityId` say what to link to.
 *
 * `dedupeKey` is what makes materialization idempotent: rows derived from the
 * order trail carry "history:<order_history.id>", the tracking review carries
 * "movement:<id>:<slotDate>:<slot>:alert", and direct writes leave it null.
 * The partial unique index on (user, dedupeKey) lets the same sweep run twice
 * without doubling anyone's inbox, while null keys stay unconstrained.
 *
 * Both FKs cascade: a notification is a copy of something that already
 * happened elsewhere, so it has nothing to protect once its user or its
 * organization is gone.
 */
export const notification = pgTable(
    "notification",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organization.id, { onDelete: "cascade" }),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        kind: text("kind", { enum: NOTIFICATION_KIND }).notNull(),
        // What the event was about, e.g. "order" + order id, "movement" + movement id
        entityType: text("entity_type"),
        entityId: text("entity_id"),
        params: jsonb("params").$type<NotificationParams>().default({}).notNull(),
        readAt: timestamp("read_at"),
        emailState: text("email_state", { enum: EMAIL_STATE }).default("none").notNull(),
        emailAttempts: integer("email_attempts").default(0).notNull(),
        emailLastError: text("email_last_error"),
        // Set on rows materialized from another table; null on direct writes
        dedupeKey: text("dedupe_key"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        index("notification_user_created_idx").on(table.userId, table.createdAt.desc()),
        index("notification_user_unread_idx").on(table.userId).where(sql`${table.readAt} is null`),
        // Idempotent materialization: the same source event can only ever
        // produce one row per user
        uniqueIndex("notification_user_dedupe_uidx")
            .on(table.userId, table.dedupeKey)
            .where(sql`${table.dedupeKey} is not null`),
        // The email worker's working set
        index("notification_email_pending_idx").on(table.emailState).where(sql`${table.emailState} = 'pending'`),
    ],
);

export type Notification = typeof notification.$inferSelect;
export type CreateNotification = typeof notification.$inferInsert;

/**
 * How far the order-trail materializer has read for one organization. The row
 * is written when the tenant activates the portal, with `now()` — history
 * older than that is never turned into notifications, so a company joining
 * today does not wake up to years of its own logbook.
 */
export const notificationCursor = pgTable("notification_cursor", {
    organizationId: text("organization_id")
        .primaryKey()
        .references(() => organization.id, { onDelete: "cascade" }),
    lastHistoryCreatedAt: timestamp("last_history_created_at").notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .$onUpdate(() => /* @__PURE__ */ new Date())
        .notNull(),
});

export type NotificationCursor = typeof notificationCursor.$inferSelect;
export type CreateNotificationCursor = typeof notificationCursor.$inferInsert;
