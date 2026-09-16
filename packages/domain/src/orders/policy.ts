import type { Actor } from "@workspace/domain/orders/actor";
import type { OrderStatus } from "@workspace/domain/orders/transitions";

/**
 * WHO may take a move, on top of WHETHER the move exists at all.
 *
 * `orders/transitions` owns the state machine — which edges exist, what
 * each one demands — and it is the same machine for everyone. This module
 * owns the second question the shared door has to answer now that partners
 * write to it: whether THIS caller is entitled to that edge on THIS order.
 *
 * Staff keep every edge the machine allows (their own permission checks
 * still apply on top). A partner only ever moves its own order, and only
 * along the part of the chain it is actually responsible for: the shipper
 * owns the quote until it is booked or dropped, the carrier owns the trip
 * from the moment it is booked until the cargo is delivered. Closing an
 * order, reversing a terminal and everything past delivery stay with
 * Appload.
 */

// The forward edges a carrier drives itself, booked → … → delivered. A
// subset of the machine's own FORWARD map: delivered → completed is
// Appload's closure, not the driver's.
const CARRIER_FORWARD: Partial<Record<OrderStatus, OrderStatus[]>> = {
    "booked": ["at-loading"],
    "at-loading": ["loading"],
    "loading": ["waiting-documents", "on-route"],
    "waiting-documents": ["on-route"],
    "on-route": ["at-border", "at-offloading"],
    "at-border": ["on-route", "at-offloading"],
    "at-offloading": ["offloading"],
    "offloading": ["delivered"],
};

const INTERRUPTS: OrderStatus[] = ["stopped", "issue"];

/** The order columns the entitlement is decided on. */
export type PolicyOrder = {
    status: OrderStatus;
    shipperId: string;
    carrierId: string | null;
};

export type PolicyOptions = {
    /** The offer a prospect → booked move accepts; a shipper has none to book without. */
    offerId?: string;
    /** The interrupt's resume target, derived from the timeline by the caller. */
    resumeStatus?: OrderStatus | null;
};

export function allowedForActor(
    actor: Actor,
    order: PolicyOrder,
    target: OrderStatus,
    opts: PolicyOptions = {},
): boolean {
    // Staff move any order the machine allows; their own role gates
    // (cancel, admin reversals, the KYC gate) are checked separately
    if (actor.kind === "staff") {
        return true;
    }

    // Which side of an order a company is on is the order's own answer, not
    // its type: a transporter that hands a load to Appload is that order's
    // shipper, and it is the carrier of the next one
    if (order.shipperId === actor.organizationId) {
        // The shipper owns its cargo while it is still a quote: it books
        // one of the offers it was given, or it drops the order. Once the
        // truck is on the job the trip is the carrier's and the closure is
        // Appload's.
        if (order.status !== "prospect" && order.status !== "booked") return false;
        if (target === "booked") return Boolean(opts.offerId);

        return target === "cancelled";
    }

    // The carrier drives its own trip forward, may park it at any point,
    // and resumes it where the timeline says it was parked
    if (order.carrierId !== actor.organizationId) return false;
    if (INTERRUPTS.includes(target)) return true;
    if (INTERRUPTS.includes(order.status)) {
        return opts.resumeStatus !== null && opts.resumeStatus !== undefined && target === opts.resumeStatus;
    }

    return CARRIER_FORWARD[order.status]?.includes(target) ?? false;
}
