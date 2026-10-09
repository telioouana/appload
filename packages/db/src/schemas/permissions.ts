import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Direct module imports, never the schema barrel (TDZ)
import { member, organization, user } from "@workspace/db/users";

export const MEMBER_PERMISSION_KIND = ["grant", "remove", "acting_owner"] as const;
export type MemberPermissionKind = (typeof MEMBER_PERMISSION_KIND)[number];

/**
 * One change to a portal member's permissions against their profile's
 * defaults (`@workspace/auth/organization-permissions` PROFILE_DEFAULTS):
 * a permission switched on or off, or the CEO's temporary lift of somebody
 * to acting CEO. A row counts only inside its window and until revoked, so
 * a temporary change ends on its own — nothing sweeps it.
 *
 * Never deleted: revoked and expired rows are the company's record of who
 * was allowed what, and when. Tenant-scoped through the portal's gate, like
 * the organization row itself, so no row security here.
 */
export const memberPermission = pgTable(
    "member_permission",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organization.id, { onDelete: "cascade" }),
        memberId: text("member_id")
            .notNull()
            .references(() => member.id, { onDelete: "cascade" }),
        kind: text("kind", { enum: MEMBER_PERMISSION_KIND }).notNull(),
        // A `resource:action` key; null on an acting-CEO row
        permission: text("permission"),
        startsAt: timestamp("starts_at").defaultNow().notNull(),
        // Null for a change with no end
        endsAt: timestamp("ends_at"),
        grantedBy: text("granted_by").references(() => user.id, { onDelete: "set null" }),
        revokedAt: timestamp("revoked_at"),
        revokedBy: text("revoked_by").references(() => user.id, { onDelete: "set null" }),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        // The gate reads one member's open rows on every request
        index("member_permission_open_idx").on(table.memberId).where(sql`${table.revokedAt} is null`),
        index("member_permission_org_idx").on(table.organizationId, table.createdAt.desc()),
    ],
);

export type MemberPermission = typeof memberPermission.$inferSelect;
export type CreateMemberPermission = typeof memberPermission.$inferInsert;
