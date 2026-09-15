import { boolean, check, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Direct module imports, never the schema barrel: going through it would pull
// in modules that depend on this one and crash at runtime (TDZ)
import { organization, user } from "@workspace/db/users";
import { THREAD_SUBJECT } from "@workspace/db/types";

/**
 * In-app conversations between the parties of one shipment.
 *
 * A thread hangs off what it is about — an Appload order or a portal load —
 * and never off a pair of people: the parties of a load are the load's, so
 * the same thread is what the shipper, the carrier and (on an order) Appload
 * ops all read. The driver is not a party here; the driver stays on WhatsApp
 * (see chat_conversation).
 *
 * Who may read and write is decided from the subject row at request time
 * (the carrier joins an order's thread only once the order is booked), and
 * `thread_participant` records the sides the thread was opened for so a
 * member's unread count is one query instead of a walk of every order.
 */
export const thread = pgTable(
    "thread",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        subjectType: text("subject_type", { enum: THREAD_SUBJECT }).notNull(),
        // No foreign key: two different tables are the subject, the same
        // trade kyc_document makes for its polymorphic subject
        subjectId: text("subject_id").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        // Bumped by every message, so a thread list sorts without a join
        lastMessageAt: timestamp("last_message_at"),
    },
    (table) => [
        // One thread per shipment, which is what makes ensureThread an upsert
        uniqueIndex("thread_subject_uidx").on(table.subjectType, table.subjectId),
    ],
);

export type Thread = typeof thread.$inferSelect;
export type CreateThread = typeof thread.$inferInsert;


/**
 * One side of a thread: an organization, or Appload staff. Sides, not users —
 * everyone in the participating organization reads the thread, and each of
 * them carries their own read cursor in `thread_read`.
 */
export const threadParticipant = pgTable(
    "thread_participant",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        threadId: text("thread_id").notNull().references(() => thread.id, { onDelete: "cascade" }),
        // Null = the Appload side; `staff` is what says so. Cascade, not set
        // null: a side whose organization is gone has nobody left to read the
        // thread, and a null-org row that is not staff would be a participant
        // on neither side.
        organizationId: text("organization_id").references(() => organization.id, { onDelete: "cascade" }),
        staff: boolean("staff").default(false).notNull(),
    },
    (table) => [
        uniqueIndex("thread_participant_org_uidx")
            .on(table.threadId, table.organizationId)
            .where(sql`${table.organizationId} is not null`),
        // At most one staff side per thread
        uniqueIndex("thread_participant_staff_uidx")
            .on(table.threadId)
            .where(sql`${table.staff}`),
        // "every thread this organization is in", the unread query's entry
        index("thread_participant_org_idx").on(table.organizationId),
    ],
);

export type ThreadParticipant = typeof threadParticipant.$inferSelect;
export type CreateThreadParticipant = typeof threadParticipant.$inferInsert;


/**
 * Per-user read cursor. Unread is "messages newer than this, sent by
 * somebody else" — the same shape the portal's chat page already uses for
 * the driver conversations (lastReadAt), so the two counts are comparable.
 */
export const threadRead = pgTable(
    "thread_read",
    {
        threadId: text("thread_id").notNull().references(() => thread.id, { onDelete: "cascade" }),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        lastReadAt: timestamp("last_read_at").defaultNow().notNull(),
    },
    (table) => [
        primaryKey({ columns: [table.threadId, table.userId] }),
    ],
);

export type ThreadRead = typeof threadRead.$inferSelect;
export type CreateThreadRead = typeof threadRead.$inferInsert;


/** A file hung off a message. Public-if-URL-known, like order documents. */
export type ThreadAttachment = {
    url: string;
    name: string;
    size?: number;
    mimeType?: string;
};

/**
 * One message. Either words or files, never neither — the CHECK is what
 * stops an empty composer from writing a row.
 */
export const threadMessage = pgTable(
    "thread_message",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        threadId: text("thread_id").notNull().references(() => thread.id, { onDelete: "cascade" }),
        senderUserId: text("sender_user_id").references(() => user.id, { onDelete: "set null" }),
        // Null = sent from the Appload side
        senderOrgId: text("sender_org_id").references(() => organization.id, { onDelete: "set null" }),
        body: text("body").default("").notNull(),
        attachments: jsonb("attachments").$type<ThreadAttachment[]>().default([]).notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        index("thread_message_thread_created_idx").on(table.threadId, table.createdAt),
        check(
            "thread_message_content_chk",
            sql`length(${table.body}) > 0 or jsonb_array_length(${table.attachments}) > 0`,
        ),
    ],
);

export type ThreadMessage = typeof threadMessage.$inferSelect;
export type CreateThreadMessage = typeof threadMessage.$inferInsert;
