/**
 * What an Appload order does to the rows linked to it.
 *
 * A load handed to Appload, and the load the carrier Appload booked, are the
 * two companies' own rows — their own books, their own references — but the
 * order is what moves. The mirror is one-way and it runs from the order's
 * doors: the row follows, never the other way round.
 *
 * Pure, so the portal can decide what to draw from the same map the server
 * writes with.
 */

import { MOVEMENT_IN_PROGRESS_STATUSES, type MovementStatus } from "@workspace/db/movements";
import type { OrderStatus } from "@workspace/db/types";

/** Which side of the order this row is: the company that asked, or the one that moves it. */
export type ApploadLinkRole = "orderer" | "executor";

/**
 * Raised by every movement door a linked row is not allowed through: the
 * order is where that load is moved from.
 */
export const FOLLOWS_APPLOAD_ORDER = "FOLLOWS_APPLOAD_ORDER";

/** The statuses a row is still waiting on an answer in — nothing was committed yet. */
const UNCOMMITTED: readonly MovementStatus[] = ["offered", "prospect", "declined"];

/**
 * Where a linked row goes when its order reaches `orderStatus`, or null when
 * it stays where it is. `unlink` clears the row's `orderId`: the load is the
 * company's own again and it may be offered somewhere else.
 *
 * `completed` is deliberately null — Appload closing its own books is not the
 * tenant closing theirs, so the row waits at `delivered` until its owner
 * closes it. A cancel that lands before anybody committed hands the orderer
 * its load back (`declined`, unlinked) instead of killing it.
 */
export function mirrorStatus(
    orderStatus: OrderStatus,
    role: ApploadLinkRole,
    current: MovementStatus,
): { status: MovementStatus; unlink: boolean } | null {
    if (orderStatus === "completed") return null;

    if (orderStatus === "cancelled" || orderStatus === "underbid") {
        if (role === "orderer" && UNCOMMITTED.includes(current)) {
            return { status: "declined", unlink: true };
        }

        return { status: "cancelled", unlink: false };
    }

    if (orderStatus === "prospect") {
        // A candidate that has already quoted is waiting on an answer, not on
        // being asked: leave it where it is
        return { status: current === "prospect" ? "prospect" : "offered", unlink: false };
    }

    if (orderStatus === "booked") return { status: "booked", unlink: false };
    if (orderStatus === "delivered") return { status: "delivered", unlink: false };

    if ((MOVEMENT_IN_PROGRESS_STATUSES as readonly string[]).includes(orderStatus)) {
        return { status: orderStatus as MovementStatus, unlink: false };
    }

    return null;
}
