import type { OfferStatus } from "@workspace/db/types";

/**
 * Whether one carrier offer may be accepted — the payload check behind
 * prospect -> booked. Booking no longer reads a filled carrier block off
 * the order row: the carrier, the fiscal regime, the carrier price and the
 * client price all arrive with the offer, and driver and truck are the
 * dispatch gate's business (./dispatch-readiness).
 *
 * The one rule left is that the offer must still be awaiting a decision: a
 * declined, withdrawn, lost or already accepted one is history, and a
 * `recorded` one was registered on a booked order for the data only. The
 * currency needs no check any more — the accepted offer prices both legs of
 * the order in its own currency.
 *
 * Pure and isomorphic like ./transitions: the transition mutation guards
 * with it and the booking dialog gates its button with it, so the dialog can
 * never offer an acceptance the mutation would refuse.
 */

export type OfferAcceptability = "ok" | "NOT_PENDING";

export function offerAcceptable(offer: { status: OfferStatus }): OfferAcceptability {
    return offer.status === "pending" ? "ok" : "NOT_PENDING";
}
