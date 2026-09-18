import { and, count, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import type { db as Database } from "@workspace/db/db";
import { subscriptionUsage, type SubscriptionPlan, type UsageEntity } from "@workspace/db/subscriptions";
import { organization } from "@workspace/db/users";

export { SUBSCRIPTION_PLAN, type SubscriptionPlan } from "@workspace/db/subscriptions";

/**
 * Tracked movements per calendar month; null = unlimited. PLACEHOLDER figures
 * until the commercial terms are final — one line each to change.
 */
export const PLAN_QUOTA: Record<SubscriptionPlan, number | null> = { starter: 10, business: 50, enterprise: null };

/**
 * The allowance is a business month, not a UTC one: a dispatch at 01:00 on the
 * first of the month in Maputo belongs to the month that just started, wherever
 * the server happens to run.
 */
export const TRACKING_TIME_ZONE = "Africa/Maputo";

// Pinned to a Gregorian locale: only the parts are read, so the locale's own
// ordering and separators never reach the key
const PERIOD_PARTS = new Intl.DateTimeFormat("en-US", {
    timeZone: TRACKING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
});

/** "YYYY-MM" of the instant in Africa/Maputo — the month a movement is billed to. */
export function periodKey(at: Date = new Date()): string {
    const parts = PERIOD_PARTS.formatToParts(at);
    const year = parts.find((part) => part.type === "year")?.value ?? "";
    const month = parts.find((part) => part.type === "month")?.value ?? "";

    return `${year}-${month}`;
}

/** A plan entitles its tenant while it is set and has not run out. */
export function planIsActive(plan: SubscriptionPlan | null, expiresAt: Date | null, at: Date = new Date()): boolean {
    return plan !== null && (expiresAt === null || expiresAt > at);
}

export type TrackingAllowance = {
    plan: SubscriptionPlan | null;
    expiresAt: Date | null;
    active: boolean;
    /** The month this was evaluated for, `periodKey(at)` */
    period: string;
    /** Movements already billed to the organization in `period` */
    used: number;
    /** The tier's monthly allowance while active, 0 without one; null = unlimited */
    quota: number | null;
    /** What is left of `quota`, never negative; null = unlimited */
    remaining: number | null;
};

/**
 * What one organization may still start this month: its plan, and how much of
 * the tier's monthly allowance the movements already billed to it have used.
 * Rebuilt from the usage rows on every call rather than kept as a counter, so
 * a lost write can never leave a tenant paying for a movement it never made.
 */
export async function trackingAllowance(
    db: typeof Database,
    organizationId: string,
    at: Date = new Date(),
): Promise<TrackingAllowance> {
    const period = periodKey(at);

    const [subscription, usage] = await Promise.all([
        db
            .select({ plan: organization.subscriptionPlan, expiresAt: organization.subscriptionExpiresAt })
            .from(organization)
            .where(eq(organization.id, organizationId))
            .limit(1)
            .then((rows) => rows[0]),
        db
            .select({ used: count() })
            .from(subscriptionUsage)
            .where(and(
                eq(subscriptionUsage.organizationId, organizationId),
                eq(subscriptionUsage.period, period),
            ))
            .then((rows) => rows[0]),
    ]);

    const plan = subscription?.plan ?? null;
    const expiresAt = subscription?.expiresAt ?? null;
    const active = planIsActive(plan, expiresAt, at);
    const used = usage?.used ?? 0;
    // An inactive plan is not "quota 0 of some tier": there is nothing to
    // spend at all, which is the SUBSCRIPTION_REQUIRED case below
    const quota = active && plan !== null ? PLAN_QUOTA[plan] : 0;

    return {
        plan,
        expiresAt,
        active,
        period,
        used,
        quota,
        remaining: quota === null ? null : Math.max(quota - used, 0),
    };
}

/**
 * The gate in front of everything that starts tracking. Throws the two codes
 * the apps render as an "activate your plan" prompt; returns the allowance so
 * the caller can report what is left without asking again.
 */
export async function assertTrackingAllowance(
    db: typeof Database,
    organizationId: string,
    at: Date = new Date(),
): Promise<TrackingAllowance> {
    const allowance = await trackingAllowance(db, organizationId, at);

    if (!allowance.active) {
        throw new TRPCError({ code: "FORBIDDEN", message: "SUBSCRIPTION_REQUIRED" });
    }

    if (allowance.remaining === 0) {
        throw new TRPCError({ code: "FORBIDDEN", message: "QUOTA_EXCEEDED" });
    }

    return allowance;
}

/**
 * Bills one movement to the organizations it belongs to, one row each. Both
 * parties of an order spend their own allowance, and an order whose other side
 * is not on the portal has one null id — those are skipped, as is the second
 * copy when a company shipped to itself.
 *
 * The unique index makes it idempotent: a re-dispatch after an interrupt, or a
 * replayed request, writes nothing and costs the month nothing.
 */
export async function recordTrackingUsage(
    db: typeof Database,
    params: {
        organizationIds: readonly (string | null)[];
        entityType: UsageEntity;
        entityId: string;
        at?: Date;
    },
): Promise<void> {
    const organizationIds = [...new Set(params.organizationIds.filter((id): id is string => id !== null))];

    if (organizationIds.length === 0) {
        return;
    }

    const period = periodKey(params.at);

    await db
        .insert(subscriptionUsage)
        .values(organizationIds.map((organizationId) => ({
            organizationId,
            period,
            entityType: params.entityType,
            entityId: params.entityId,
        })))
        .onConflictDoNothing();
}
