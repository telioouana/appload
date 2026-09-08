import { and, eq, inArray, isNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm";

import { order } from "@workspace/db/orders";
import { ACTIVE_DISPUTE_STATUSES } from "@workspace/db/types";

import {
    INTERRUPTED_STATUSES,
    PENDING_POD_STATUSES,
    PRE_LOADING_STATUSES,
    UNBILLABLE_STATUSES,
} from "@/frontend/pages/orders/types";
import type { OrderStatus } from "@/frontend/pages/orders/types";

// ---------------------------------------------------------------------------
// Conditions the toggles, the filters and the stats all share, so a count
// is always the count its filter opens. They sit in lib/ rather than in the
// orders router because the dashboard router counts with them too, and one
// router importing another would drag its mutations along.
// ---------------------------------------------------------------------------

export const thisYear = () => new Date().getFullYear();

/** Server-local midnight `days` ahead — the boundary the `loading=` filter already uses. */
export const daysFromNow = (days: number) => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
};

/** Due at the loading site within `days` — or already overdue — and not loaded yet. */
export const loadingDue = (days: number) =>
    and(inArray(order.status, PRE_LOADING_STATUSES), lt(order.expectedLoadingDate, daysFromNow(days + 1)))!;

/** Expected at the loading site and the date has passed — not loaded yet. */
export const loadingOverdue = () =>
    and(inArray(order.status, PRE_LOADING_STATUSES), lt(order.expectedLoadingDate, daysFromNow(0)))!;

/** A quote whose loading date is within `days` (or past) — needs confirming now. */
export const prospectDueSoon = (days: number) =>
    and(eq(order.status, "prospect"), lt(order.expectedLoadingDate, daysFromNow(days + 1)))!;

export const interrupted = () => inArray(order.status, INTERRUPTED_STATUSES);

export const flagged = () => eq(order.flaggedForReview, true);

export const awaitingPod = () =>
    and(eq(order.status, "delivered"), or(isNull(order.podStatus), inArray(order.podStatus, [...PENDING_POD_STATUSES])))!;

/** Insurance Appload took out on the shipper's behalf and has not paid yet. */
export const insuranceToPay = () =>
    and(eq(order.insuranceSubscriber, "appload"), eq(order.insuranceStatus, "pending"))!;

export const billable = () => notInArray(order.status, UNBILLABLE_STATUSES);

export const disputed = () => inArray(order.disputeStatus, [...ACTIVE_DISPUTE_STATUSES]);

export const conditionCount = (condition: SQL) =>
    sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

export const statusCount = (status: OrderStatus) =>
    sql<number>`count(*) filter (where ${order.status} = ${status})`.mapWith(Number);
