import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Direct module imports, never the schema barrel: going through it would pull
// in modules that depend on this one and crash at runtime (TDZ)
import { organization, user } from "@workspace/db/users";

/** What the two organizations are to each other — see `partnerConnection.relation`. */
export const CONNECTION_RELATION = ["client-carrier", "subcontract"] as const;
export type ConnectionRelation = (typeof CONNECTION_RELATION)[number];

/** Lifecycle of a connection request — see `partnerConnection.status`. */
export const CONNECTION_STATUS = ["pending", "accepted", "declined", "removed"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUS)[number];

/** How an accepted connection came about — see `partnerConnection.acceptedVia`. */
export const CONNECTION_VIA = ["response", "registration", "staff", "award"] as const;
export type ConnectionVia = (typeof CONNECTION_VIA)[number];

/**
 * A link between two organizations on the portal: who may send an order to
 * whom, who may quote whom. One row per pair, whichever side asked — the
 * unique index is on the sorted pair, not on (requester, target), so the same
 * two companies can never end up with a connection each way. `relation` says
 * what the link is: "client-carrier" is the normal shipper→carrier link,
 * "subcontract" is a carrier hiring another carrier (the requester is the
 * contractor).
 *
 * The organization FKs are `restrict`: a connection is the record of a
 * commercial relationship and the orders exchanged under it hang off both
 * sides, so an organization row is never deleted out from under one. The user
 * FKs are `set null` — who clicked is context, not the relationship itself.
 *
 * Removing a connection sets `status` to "removed" rather than deleting the
 * row, so the pair keeps its history and a later re-request updates the same
 * row.
 */
export const partnerConnection = pgTable(
    "partner_connection",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        requesterOrgId: text("requester_org_id")
            .notNull()
            .references(() => organization.id, { onDelete: "restrict" }),
        targetOrgId: text("target_org_id")
            .notNull()
            .references(() => organization.id, { onDelete: "restrict" }),
        relation: text("relation", { enum: CONNECTION_RELATION }).notNull(),
        status: text("status", { enum: CONNECTION_STATUS }).default("pending").notNull(),
        acceptedVia: text("accepted_via", { enum: CONNECTION_VIA }),
        // Free text the requester attached to the invitation
        message: text("message"),
        requestedByUserId: text("requested_by_user_id").references(() => user.id, { onDelete: "set null" }),
        respondedByUserId: text("responded_by_user_id").references(() => user.id, { onDelete: "set null" }),
        respondedAt: timestamp("responded_at"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    },
    (table) => [
        // One row per pair regardless of who asked: sorting the two ids makes
        // (a, b) and (b, a) the same index key
        uniqueIndex("partner_connection_pair_uidx").on(
            sql`least(${table.requesterOrgId}, ${table.targetOrgId})`,
            sql`greatest(${table.requesterOrgId}, ${table.targetOrgId})`,
        ),
        index("partner_connection_target_status_idx").on(table.targetOrgId, table.status),
        index("partner_connection_requester_status_idx").on(table.requesterOrgId, table.status),
        check("partner_connection_distinct_ck", sql`${table.requesterOrgId} <> ${table.targetOrgId}`),
    ],
);

export type PartnerConnection = typeof partnerConnection.$inferSelect;
export type CreatePartnerConnection = typeof partnerConnection.$inferInsert;

/** Lifecycle of a claim on an existing organization — see `organizationClaim.status`. */
export const CLAIM_STATUS = ["pending", "approved", "rejected"] as const;
export type ClaimStatus = (typeof CLAIM_STATUS)[number];

/**
 * A user asking to become the owner of an organization that already exists in
 * the database but has no members — every company Appload loaded from the
 * logbook is in that state. Auto-approved when the verified sign-up email
 * matches the organization's registered email (placeholder emails never
 * match); otherwise ops decides it from the Admin partners queue.
 *
 * At most one pending claim per organization (partial unique index); decided
 * ones stay as the record of who asked and what was answered.
 */
export const organizationClaim = pgTable(
    "organization_claim",
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
        status: text("status", { enum: CLAIM_STATUS }).default("pending").notNull(),
        // True when the email match decided it, so a reader can tell an
        // automatic approval from an ops one
        autoApproved: boolean("auto_approved").default(false).notNull(),
        decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
        decidedAt: timestamp("decided_at"),
        decisionNote: text("decision_note"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        // One open claim per organization: the queue never shows two
        uniqueIndex("organization_claim_pending_uidx")
            .on(table.organizationId)
            .where(sql`${table.status} = 'pending'`),
        index("organization_claim_user_idx").on(table.userId),
    ],
);

export type OrganizationClaim = typeof organizationClaim.$inferSelect;
export type CreateOrganizationClaim = typeof organizationClaim.$inferInsert;
