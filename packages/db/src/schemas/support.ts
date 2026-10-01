import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Direct module imports, never the schema barrel (TDZ)
import { organization, user } from "@workspace/db/users";

/**
 * A company's own decision to open its books to Appload support for a while:
 * who granted it, why, until when, and whether it was taken back early.
 * The trust wall reads it (rls.ts `supportGranted`): while a grant is live,
 * staff read that company's loads, contracts and client list — its own rows
 * only, never rows that merely name it as the other party.
 *
 * Never deleted: the history is the company's record of who was let in.
 * No row security on the table itself — staff must read it for the policies
 * on the other tables to work, and there is nothing in it but the grant.
 */
export const supportAccessGrant = pgTable(
    "support_access_grant",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organization.id, { onDelete: "cascade" }),
        grantedBy: text("granted_by").references(() => user.id, { onDelete: "set null" }),
        reason: text("reason").notNull(),
        expiresAt: timestamp("expires_at").notNull(),
        revokedAt: timestamp("revoked_at"),
        revokedBy: text("revoked_by").references(() => user.id, { onDelete: "set null" }),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        // The policies look up the live grant of one company on every row read
        index("support_access_grant_live_idx").on(table.organizationId, table.expiresAt).where(sql`${table.revokedAt} is null`),
    ],
);

export type SupportAccessGrant = typeof supportAccessGrant.$inferSelect;
export type CreateSupportAccessGrant = typeof supportAccessGrant.$inferInsert;
