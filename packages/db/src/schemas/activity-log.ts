import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

import { ACTIVITY_STATUS } from "@workspace/db/types";

// Display-safe values only; the activity catalog whitelists what goes in here
export type ActivityParams = Record<string, string | number | boolean | null>;

// Append-only audit trail of meaningful user actions (sign-ins, session
// resumes, every tRPC mutation). Intentionally has NO foreign keys: user rows
// cascade-delete and session rows are removed on sign-out, but the trail must
// survive both — hence the actorName snapshot.
export const activityLog = pgTable(
    "activity_log",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        // Dotted action key, e.g. "order.create", "auth.sign_in", "session.resumed"
        action: text("action").notNull(),
        actorId: text("actor_id").notNull(),
        actorName: text("actor_name"),
        sessionId: text("session_id"),
        organizationId: text("organization_id"),
        // What the action was performed on, e.g. "order" / "APPL021.26"
        entityType: text("entity_type"),
        entityId: text("entity_id"),
        params: jsonb("params").$type<ActivityParams>().default({}).notNull(),
        status: text("status", { enum: ACTIVITY_STATUS }).default("success").notNull(),
        // TRPCError code plus the domain code, e.g. "CONFLICT:DUPLICATE_PLATE"
        errorCode: text("error_code"),
        ipAddress: text("ip_address"),
        userAgent: text("user_agent"),
        city: text("city"),
        country: text("country"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        index("activity_log_actor_created_idx").on(table.actorId, table.createdAt),
        index("activity_log_session_created_idx").on(table.sessionId, table.createdAt),
        index("activity_log_action_idx").on(table.action),
    ],
);

export type ActivityLog = typeof activityLog.$inferSelect;
export type CreateActivityLog = typeof activityLog.$inferInsert;
