import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Direct module imports, never the schema barrel: going through it would pull
// in modules that depend on this one and crash at runtime (TDZ)
import { organization } from "@workspace/db/users";

// The tiers a plan can be, agreed commercially and recorded by staff. Text +
// TS const (never a pg enum) so renaming or adding a tier never needs an
// ALTER TYPE on the shared database; null on `organization.subscriptionPlan`
// means no plan yet. It is declared in the types module because `organization`
// carries the column and users.ts imports no table module (see there).
export { SUBSCRIPTION_PLAN, type SubscriptionPlan } from "@workspace/db/types";

/** What a usage row counts — see `subscriptionUsage.entityType`. */
export const USAGE_ENTITY = ["order", "movement"] as const;
export type UsageEntity = (typeof USAGE_ENTITY)[number];

/**
 * One tracked movement, billed to one organization for one calendar month:
 * an order that got dispatched, a movement that entered progress. Both parties
 * of an order get their own row, since each spends its own allowance.
 *
 * The unique index is what makes counting idempotent: a re-dispatch after an
 * interrupt writes nothing, so an order can only ever cost the month once.
 * `period` is "YYYY-MM" in Africa/Maputo (the month is a business month, not
 * a UTC one) and `entityId` is the order's primary key, never its display
 * `order_id`.
 */
export const subscriptionUsage = pgTable(
    "subscription_usage",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organization.id, { onDelete: "cascade" }),
        period: text("period").notNull(),
        entityType: text("entity_type", { enum: USAGE_ENTITY }).notNull(),
        entityId: text("entity_id").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex("subscription_usage_entity_uq").on(table.organizationId, table.entityType, table.entityId),
        // What the allowance query reads: this tenant's rows for one month
        index("subscription_usage_period_idx").on(table.organizationId, table.period),
    ],
);

export type SubscriptionUsage = typeof subscriptionUsage.$inferSelect;
export type CreateSubscriptionUsage = typeof subscriptionUsage.$inferInsert;
