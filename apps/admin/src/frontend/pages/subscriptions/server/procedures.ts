import { z } from "zod";
import { and, asc, count, desc, eq, gt, ilike, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";

import { organization } from "@workspace/db/users";
import { subscriptionUsage } from "@workspace/db/subscriptions";
import { SUBSCRIPTION_PLAN } from "@workspace/db/types";
import type { db as Database } from "@workspace/db/db";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";

import { periodKey, PLAN_QUOTA, planIsActive } from "@workspace/domain/subscription";
import {
    EXPIRING_WINDOW_DAYS,
    ORGANIZATION_TYPES,
    SUBSCRIPTION_SORTS,
    SUBSCRIPTION_STATES,
    type SubscriptionCounts,
    type SubscriptionRow,
} from "@/frontend/pages/subscriptions/types";

type Db = typeof Database;

const ListInput = z.object({
    search: z.string().trim().max(120).optional(),
    status: z.enum(SUBSCRIPTION_STATES).optional(),
    type: z.enum(ORGANIZATION_TYPES).optional(),
    plan: z.enum(SUBSCRIPTION_PLAN).optional(),
    sort: z.enum(SUBSCRIPTION_SORTS).optional(),
    dir: z.enum(["asc", "desc"]).default("asc"),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).default(25),
});

// Escape LIKE wildcards so user input matches literally
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

/**
 * The state conditions, evaluated at `now` so the list and its counts agree.
 * "expiring" is a slice of "active": the tab strip shows it on its own, the
 * active tab still includes it.
 */
function stateConditions(now: Date) {
    const horizon = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * 86_400_000);

    const active = or(isNull(organization.subscriptionExpiresAt), gt(organization.subscriptionExpiresAt, now))!;
    const expired = lte(organization.subscriptionExpiresAt, now);
    const expiring = and(gt(organization.subscriptionExpiresAt, now), lte(organization.subscriptionExpiresAt, horizon))!;

    return { active, expiring, expired };
}

/** Everything the list narrows on except the state tab. */
function scope(input: z.infer<typeof ListInput>): SQL {
    const conditions: SQL[] = [isNotNull(organization.subscriptionPlan)];

    if (input.type) conditions.push(eq(organization.type, input.type));
    if (input.plan) conditions.push(eq(organization.subscriptionPlan, input.plan));

    if (input.search) {
        const term = `%${escapeLike(input.search)}%`;
        conditions.push(or(ilike(organization.name, term), ilike(organization.nuit, term))!);
    }

    return and(...conditions)!;
}

const conditionCount = (condition: SQL) => sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

export const subscriptionsRouter = createTRPCRouter({
    /**
     * Every organization with a plan, where it stands and what it has spent
     * this month. Counts come along with the page so the tab strip needs no
     * second round trip; they ignore the state tab but follow every other
     * filter, like the partner pages' tiles.
     */
    list: authorizedProcedure("organizations", ["read"])
        .input(ListInput)
        .query(async ({ ctx, input }) => {
            const now = new Date();
            const states = stateConditions(now);
            const where = scope(input);
            const page = input.page ?? 1;
            const offset = (page - 1) * input.pageSize;

            // This month's usage per organization — the same rows the portal's
            // gate counts, joined so the page never asks per row
            const usage = ctx.db
                .select({ organizationId: subscriptionUsage.organizationId, used: count().as("used") })
                .from(subscriptionUsage)
                .where(eq(subscriptionUsage.period, periodKey(now)))
                .groupBy(subscriptionUsage.organizationId)
                .as("usage");

            const listWhere = input.status ? and(where, states[input.status])! : where;

            const order = input.dir === "desc" ? desc : asc;
            const orderBy = input.sort === "plan"
                // Tier order, not alphabetical: the catalog array is the ladder
                ? [sql`array_position(${sql.raw(`ARRAY[${SUBSCRIPTION_PLAN.map((plan) => `'${plan}'`).join(", ")}]::text[]`)}, ${organization.subscriptionPlan}) ${sql.raw(input.dir)}`, asc(organization.name)]
                : input.sort === "expires"
                    // Open-ended subscriptions have no date to sort by; they sit at the end either way
                    ? [sql`${organization.subscriptionExpiresAt} ${sql.raw(input.dir)} nulls last`, asc(organization.name)]
                    : [order(organization.name)];

            const [rows, [totals]] = await Promise.all([
                ctx.db
                    .select({
                        id: organization.id,
                        name: organization.name,
                        logo: organization.logo,
                        type: organization.type,
                        plan: organization.subscriptionPlan,
                        expiresAt: organization.subscriptionExpiresAt,
                        portalActivatedAt: organization.portalActivatedAt,
                        used: sql<number>`coalesce(${usage.used}, 0)`.mapWith(Number),
                    })
                    .from(organization)
                    .leftJoin(usage, eq(usage.organizationId, organization.id))
                    .where(listWhere)
                    .orderBy(...orderBy)
                    .limit(input.pageSize)
                    .offset(offset),
                ctx.db
                    .select({
                        all: count(),
                        active: conditionCount(states.active),
                        expiring: conditionCount(states.expiring),
                        expired: conditionCount(states.expired),
                        listed: conditionCount(listWhere),
                    })
                    .from(organization)
                    .where(where),
            ]);

            const items: SubscriptionRow[] = rows.flatMap((row) => {
                // The scope guarantees a plan; the type only knows the column is nullable
                if (!row.plan || (row.type !== "shipper" && row.type !== "carrier")) return [];

                // Same rule as trackingAllowance: an expired plan has nothing to spend
                const quota = planIsActive(row.plan, row.expiresAt, now) ? PLAN_QUOTA[row.plan] : 0;

                return [{
                    ...row,
                    plan: row.plan,
                    type: row.type,
                    quota,
                    // What the month's invoice adds on top of the plan
                    extra: quota === null ? 0 : Math.max(row.used - quota, 0),
                }];
            });

            const counts: SubscriptionCounts = {
                all: totals?.all ?? 0,
                active: totals?.active ?? 0,
                expiring: totals?.expiring ?? 0,
                expired: totals?.expired ?? 0,
            };

            return { items, total: totals?.listed ?? 0, page, pageSize: input.pageSize, counts };
        }),

    /** Organizations without a plan yet, for the "Add subscription" picker. */
    candidates: authorizedProcedure("organizations", ["read"])
        .input(z.object({ search: z.string().trim().max(120) }))
        .query(async ({ ctx, input }) => {
            const term = `%${escapeLike(input.search)}%`;

            return ctx.db
                .select({ id: organization.id, name: organization.name, logo: organization.logo, type: organization.type })
                .from(organization)
                .where(and(
                    isNull(organization.subscriptionPlan),
                    or(eq(organization.type, "shipper"), eq(organization.type, "carrier")),
                    input.search ? or(ilike(organization.name, term), ilike(organization.nuit, term)) : undefined,
                ))
                .orderBy(asc(organization.name))
                .limit(10);
        }),
});

export type SubscriptionsDb = Db;
