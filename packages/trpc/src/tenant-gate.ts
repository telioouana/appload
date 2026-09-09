import { desc, eq } from "drizzle-orm";

import { member, organization, user } from "@workspace/db/users";
import type { db as Database } from "@workspace/db/db";

export type TenantReason =
    | "NOT_PARTNER_ACCOUNT"
    | "EMAIL_UNVERIFIED"
    | "NO_ORGANIZATION"
    | "ORGANIZATION_CLOSED"
    | "BANNED";

export type OrgType = "shipper" | "carrier";
export type OrgStatus = "pending" | "active" | "closed";
export type TenantRole = "owner" | "admin" | "member";

export type TenantPlan = {
    plan: "free" | "pro";
    // Null on the free plan and on a subscription with no end date
    expiresAt: Date | null;
    isPro: boolean;
};

// Discriminated on `ok` so a procedure that has thrown on `!ok` sees the
// organization fields as non-nullable, while onboarding — which runs before
// there is a membership — can still read what was resolved.
export type TenantGates =
    | {
        ok: true;
        reason?: undefined;
        userId: string;
        organizationId: string;
        orgType: OrgType;
        orgStatus: OrgStatus;
        role: TenantRole;
        emailVerified: boolean;
        plan: TenantPlan;
    }
    | {
        ok: false;
        reason: TenantReason;
        userId: string;
        organizationId: string | null;
        orgType: OrgType | null;
        orgStatus: OrgStatus | null;
        role: TenantRole | null;
        emailVerified: boolean;
        plan: TenantPlan;
    };

const FREE_PLAN: TenantPlan = { plan: "free", expiresAt: null, isPro: false };

/**
 * Reads the actor's account and its single membership live from the database.
 * The session cookie's `activeOrganizationId` is never consulted for tenancy:
 * it is null until the client calls `setActive` and Better Auth's organization
 * cookie cache keeps it stale for up to 5 minutes after `addMember` /
 * `acceptInvitation` — a hard gate must agree with the database, not with a
 * cookie.
 */
export async function getTenantGates(
    db: typeof Database,
    params: { userId: string },
): Promise<TenantGates> {
    const [account, membership] = await Promise.all([
        db
            .select({
                type: user.type,
                banned: user.banned,
                status: user.status,
                emailVerified: user.emailVerified,
            })
            .from(user)
            .where(eq(user.id, params.userId))
            .limit(1)
            .then((rows) => rows[0]),
        // `organizationLimit` is 1, so there is at most one row — newest wins
        // if a stale membership was ever left behind
        db
            .select({
                organizationId: member.organizationId,
                role: member.role,
                orgType: organization.type,
                orgStatus: organization.status,
                plan: organization.subscriptionPlan,
                expiresAt: organization.subscriptionExpiresAt,
            })
            .from(member)
            .innerJoin(organization, eq(organization.id, member.organizationId))
            .where(eq(member.userId, params.userId))
            .orderBy(desc(member.createdAt))
            .limit(1)
            .then((rows) => rows[0]),
    ]);

    const emailVerified = account?.emailVerified === true;

    const plan: TenantPlan = membership
        ? {
            plan: membership.plan,
            expiresAt: membership.expiresAt,
            isPro:
                membership.plan === "pro" &&
                (membership.expiresAt === null || membership.expiresAt > new Date()),
        }
        : FREE_PLAN;

    const role: TenantRole =
        membership?.role === "owner" ? "owner" :
            membership?.role === "admin" ? "admin" :
                "member";

    const resolved = {
        userId: params.userId,
        organizationId: membership?.organizationId ?? null,
        orgType: membership?.orgType ?? null,
        orgStatus: membership?.orgStatus ?? null,
        role: membership ? role : null,
        emailVerified,
        plan,
    };

    const deny = (reason: TenantReason): TenantGates => ({ ok: false, reason, ...resolved });

    // The portal is partner-only: staff and driver accounts are rejected
    // before anything else is looked at
    if (account?.type !== "shipper" && account?.type !== "carrier") {
        return deny("NOT_PARTNER_ACCOUNT");
    }
    // A closed account is denied for the same reason a banned one is; the
    // reason vocabulary has no separate code for it
    if (account.banned === true || account.status === "closed") return deny("BANNED");
    if (!emailVerified) return deny("EMAIL_UNVERIFIED");
    if (!membership) return deny("NO_ORGANIZATION");
    if (membership.orgStatus === "closed") return deny("ORGANIZATION_CLOSED");

    return {
        ok: true,
        userId: params.userId,
        organizationId: membership.organizationId,
        orgType: membership.orgType,
        orgStatus: membership.orgStatus,
        role,
        emailVerified,
        plan,
    };
}
