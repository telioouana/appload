import { and, desc, eq, gt, isNull, or } from "drizzle-orm";

import { effectiveAccess, profileOf, type Permission, type Profile } from "@workspace/auth/organization-permissions";
import { memberPermission } from "@workspace/db/permissions";
import { member, organization, user } from "@workspace/db/users";
import { isPartnerOrgType, type PartnerOrgType } from "@workspace/db/types";
import type { db as Database } from "@workspace/db/db";
import { PLAN_QUOTA, planIsActive, type SubscriptionPlan } from "@workspace/domain/subscription";

export type TenantReason =
    | "NOT_PARTNER_ACCOUNT"
    | "EMAIL_UNVERIFIED"
    | "NO_ORGANIZATION"
    | "ORGANIZATION_CLOSED"
    | "BANNED";

// The portal is partner-only, so a tenant's organization is never Appload's
// own row: the gate below denies a membership of any other type
export type OrgType = PartnerOrgType;
export type OrgStatus = "pending" | "active" | "closed";
/** The member's profile (`member.role`); what they may do is `permissions` */
export type TenantRole = Profile;

export type TenantPlan = {
    // Null until staff record the tier that was agreed commercially
    plan: SubscriptionPlan | null;
    // Null on a subscription with no end date
    expiresAt: Date | null;
    active: boolean;
    // The tier's monthly allowance of tracked movements, 0 without an active
    // plan and null when unlimited. What is left of it is not counted here:
    // one more query on every request is not worth it, and the movements that
    // spend it check their own allowance at the door
    quota: number | null;
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
        memberId: string;
        /** 3 while an acting-CEO lift is live, whatever the profile */
        level: 1 | 2 | 3;
        actingOwner: boolean;
        /** The profile's defaults with this member's live changes applied */
        permissions: ReadonlySet<Permission>;
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
        memberId?: undefined;
        level?: undefined;
        actingOwner?: undefined;
        permissions: ReadonlySet<Permission>;
        emailVerified: boolean;
        plan: TenantPlan;
    };

const NO_PLAN: TenantPlan = { plan: null, expiresAt: null, active: false, quota: 0 };

const NO_PERMISSIONS: ReadonlySet<Permission> = new Set();

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
    const now = new Date();
    const [account, membership, changes] = await Promise.all([
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
                memberId: member.id,
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
        // The member's own permission changes still open, read alongside the
        // membership rather than after it — one round-trip, not two — and
        // matched to the membership below (`organizationLimit` is 1)
        db
            .select({
                memberId: memberPermission.memberId,
                kind: memberPermission.kind,
                permission: memberPermission.permission,
                startsAt: memberPermission.startsAt,
                endsAt: memberPermission.endsAt,
                revokedAt: memberPermission.revokedAt,
                createdAt: memberPermission.createdAt,
            })
            .from(memberPermission)
            .innerJoin(member, eq(member.id, memberPermission.memberId))
            .where(and(
                eq(member.userId, params.userId),
                isNull(memberPermission.revokedAt),
                or(isNull(memberPermission.endsAt), gt(memberPermission.endsAt, now)),
            )),
    ]);

    const emailVerified = account?.emailVerified === true;

    const active = membership ? planIsActive(membership.plan, membership.expiresAt) : false;

    const plan: TenantPlan = membership
        ? {
            plan: membership.plan,
            expiresAt: membership.expiresAt,
            active,
            quota: active && membership.plan !== null ? PLAN_QUOTA[membership.plan] : 0,
        }
        : NO_PLAN;

    const role: TenantRole = profileOf(membership?.role);

    // Resolved live on every request, so a change or a lapsed window counts
    // on the very next click
    const access = membership
        ? effectiveAccess(role, changes.filter((change) => change.memberId === membership.memberId), now)
        : null;

    const resolved = {
        userId: params.userId,
        organizationId: membership?.organizationId ?? null,
        // Anything but shipper|carrier is not a tenant at all — the deny below
        orgType: membership && isPartnerOrgType(membership.orgType) ? membership.orgType : null,
        orgStatus: membership?.orgStatus ?? null,
        role: membership ? role : null,
        permissions: access?.permissions ?? NO_PERMISSIONS,
        emailVerified,
        plan,
    };

    const deny = (reason: TenantReason): TenantGates => ({ ok: false, reason, ...resolved, permissions: NO_PERMISSIONS });

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
    // Appload's own organization is a partner on the platform, not a tenant of
    // it: it never has members, and a stray one is no more a portal account
    // than a staff login is
    if (!isPartnerOrgType(membership.orgType)) return deny("NOT_PARTNER_ACCOUNT");
    if (membership.orgStatus === "closed") return deny("ORGANIZATION_CLOSED");

    return {
        ok: true,
        userId: params.userId,
        organizationId: membership.organizationId,
        orgType: membership.orgType,
        orgStatus: membership.orgStatus,
        role,
        memberId: membership.memberId,
        level: access!.level,
        actingOwner: access!.actingOwner,
        permissions: access!.permissions,
        emailVerified,
        plan,
    };
}
