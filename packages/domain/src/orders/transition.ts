import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { order, orderDocument, orderHistory, orderOffer, type CreateOrder, type Order, type OrderOffer } from "@workspace/db/orders";
import type { db as Database } from "@workspace/db/db";
import { isActiveDispute } from "@workspace/db/types";
import { isAuthorized } from "@workspace/auth/user-permissions";

import type { Actor } from "@workspace/domain/orders/actor";
import { guardOrderGate } from "@workspace/domain/kyc/order-gate";
import { FOLLOW_UP_STATUSES, startConversation } from "@workspace/domain/tracking/conversations";
import { offerAcceptable } from "@workspace/domain/orders/booking-readiness";
import { deriveOrderFields } from "@workspace/domain/orders/derive";
import { isReadyToDispatch } from "@workspace/domain/orders/dispatch-readiness";
import { changedCurrencyParties, partiesWithMoneyDocuments } from "@workspace/domain/orders/note-currency";
import { proofPaymentPatch } from "@workspace/domain/orders/payments";
import { paymentSums } from "@workspace/domain/orders/payment-sums";
import { allowedForActor } from "@workspace/domain/orders/policy";
import { recordSheetSync, type SheetSyncResult } from "@workspace/domain/orders/sheet-sync";
import { validateTransition, type OrderStatus } from "@workspace/domain/orders/transitions";
import { assertTrackingAllowance, recordTrackingUsage } from "@workspace/domain/subscription";

/**
 * What an order write needs from the request, whichever app made it: the
 * database, who is asking, somewhere to park a best-effort promise, and
 * what to do about the Sheets logbook. Admin passes its own push (the
 * Google client, the tokens and the sheet mapping all stay in the app);
 * the portal passes "defer" and lets the outbox cron heal the logbook.
 */
export type OrderContext = {
    db: typeof Database;
    actor: Actor;
    waitUntil?: (promise: Promise<unknown>) => void;
    sheets: { push: (row: Order) => Promise<SheetSyncResult> } | "defer";
};

/** What a status change carries; Admin's TransitionSchema parses into it. */
export type TransitionParams = {
    orderId: string;
    to: OrderStatus;
    expectedVersion: number;
    note?: string;
    // The carrier offer prospect → booked accepts; ignored by every other
    // move, since booking is the only one that commits a carrier
    offerId?: string;
    // Evidence/POD upload backing the move (EdgeStore URL). The
    // document row itself is created by the documents router;
    // here it also lands in the history metadata.
    document?: {
        url: string;
        name?: string;
        size?: number;
        mimeType?: string;
    };
};

/**
 * A leg's currency is what gives the stored note totals and proof-of-payment
 * sums their meaning, so it cannot be repointed once that party has live
 * notes or has ever had a proof — the totals would be silently
 * reinterpreted. Callers must have already loaded `current`.
 */
export async function assertCurrencyUnlocked(
    db: typeof Database,
    patch: { shipperCurrency?: string | null; carrierCurrency?: string | null },
    current: { id: string; shipperCurrency: string | null; carrierCurrency: string | null },
) {
    const changing = changedCurrencyParties(patch, current);

    if (!changing.length) return;

    const locked = await partiesWithMoneyDocuments(db, current.id);

    if (changing.some((party) => locked.has(party))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "NOTE_CURRENCY_LOCKED" });
    }
}

/**
 * What a booking writes into its transition history row, so the timeline
 * can say WHICH offer booked the order and on what terms without joining
 * back to a row that may since have been re-priced.
 */
export type BookedOfferMetadata = {
    id: string;
    carrierName: string;
    total: number;
    currency: string;
    includesGit: boolean;
    includesGps: boolean;
};

export const offerMetadata = (offer: OrderOffer): BookedOfferMetadata => ({
    id: offer.id,
    carrierName: offer.carrierName,
    total: Number(offer.total),
    currency: offer.currency,
    includesGit: offer.includesGit,
    includesGps: offer.includesGps,
});

// Only Date-valued keys, so the same object can feed both the drizzle
// .set() clause and deriveOrderFields' patch parameter
type TransitionStamps = Partial<Record<
    | "arrivalAtLoading" | "actualLoadingDate" | "departureLoadingDate"
    | "departureFromBorder" | "arrivalAtBorder" | "arrivalAtOffloading"
    | "actualOffloadingDate" | "departureOffloadingDate",
    Date
>>;

/**
 * Milestone timestamps implied by a transition, stamped only when still
 * empty — arriving at the border IS the arrival time. Ops can correct the
 * exact time later through the edit form.
 */
function transitionStamps(current: Order, to: OrderStatus): TransitionStamps {
    const stamps: TransitionStamps = {};
    const now = new Date();

    switch (to) {
        case "at-loading":
            if (current.arrivalAtLoading === null) stamps.arrivalAtLoading = now;
            break;
        case "loading":
            if (current.actualLoadingDate === null) stamps.actualLoadingDate = now;
            break;
        case "on-route":
            if (current.status === "at-border" && current.departureFromBorder === null) {
                stamps.departureFromBorder = now;
            }
            if ((current.status === "loading" || current.status === "waiting-documents") && current.departureLoadingDate === null) {
                stamps.departureLoadingDate = now;
            }
            break;
        case "at-border":
            if (current.arrivalAtBorder === null) stamps.arrivalAtBorder = now;
            break;
        case "at-offloading":
            if (current.arrivalAtOffloading === null) stamps.arrivalAtOffloading = now;
            break;
        case "offloading":
            if (current.actualOffloadingDate === null) stamps.actualOffloadingDate = now;
            break;
        case "delivered":
            if (current.departureOffloadingDate === null) stamps.departureOffloadingDate = now;
            break;
    }

    return stamps;
}

/**
 * Booked/tracked side effect: open (or relink) the driver's follow-up
 * conversation. Skips silently when the order has no driver phone yet —
 * a booking rarely names a driver, and order.update opens the thread
 * when the phone arrives.
 */
export async function startFollowUpChat(db: typeof Database, updated: Order, orderPk: string): Promise<void> {
    if (!updated.driverPhoneNumber) {
        return;
    }

    const { conversation, existing, relinked } = await startConversation(db, {
        driverName: updated.driverName ?? updated.driverPhoneNumber,
        driverPhone: updated.driverPhoneNumber,
        orderId: updated.orderId,
    });

    // Only real changes land in history — the hook now fires on every
    // tracked transition, and an untouched thread is not worth a row
    if (existing && !relinked) {
        return;
    }

    await db.insert(orderHistory).values({
        orderId: orderPk,
        actorUserId: null,
        kind: "system",
        metadata: { followUpChat: relinked ? "relinked" : "created", conversationId: conversation.id },
    });
}

/**
 * The one rule for where an interrupted (stopped/issue) order goes back to:
 * the last transition target outside the interrupt pair. Two callers
 * evaluate it — this module against the database, and `resumeFromHistory`
 * against rows already in memory — so the pair lives here together. A drift
 * between them would offer the operator a resume target the server refuses.
 */
const RESUME_EXCLUDED: OrderStatus[] = ["stopped", "issue"];

/**
 * The resume target read off an already-fetched timeline, newest first.
 * `toStatus` is null on rows that are not transitions, and SQL's NOT IN
 * drops those on its own — the explicit null check here is what keeps this
 * branch in step with the query below.
 */
export function resumeFromHistory(
    history: { kind: string; toStatus: string | null }[],
): OrderStatus | null {
    const found = history.find((entry) =>
        entry.kind === "transition"
        && entry.toStatus !== null
        && !RESUME_EXCLUDED.includes(entry.toStatus as OrderStatus));

    return (found?.toStatus as OrderStatus | undefined) ?? null;
}

/** The same rule against the database, for callers without the timeline. */
export async function deriveResumeStatus(db: typeof Database, orderPk: string): Promise<OrderStatus | null> {
    const [row] = await db
        .select({ toStatus: orderHistory.toStatus })
        .from(orderHistory)
        .where(and(
            eq(orderHistory.orderId, orderPk),
            eq(orderHistory.kind, "transition"),
            notInArray(orderHistory.toStatus, RESUME_EXCLUDED),
        ))
        .orderBy(desc(orderHistory.createdAt))
        .limit(1);

    return row?.toStatus ?? null;
}

/**
 * How many offers on a row are still awaiting a decision, as a correlated
 * subquery — the orders list and the transition options both need it next
 * to the order's own columns.
 *
 * The conditions go in as drizzle expressions rather than as bare columns:
 * a `PgColumn` interpolated directly into a selection-field template loses
 * its table prefix when the query has no joins, which would bind
 * `order_id`/`status` to the wrong table. A nested SQL object is left
 * alone and renders fully qualified.
 */
export const pendingOfferCount = sql<number>`(
    select count(*) from ${orderOffer}
    where ${and(eq(orderOffer.orderId, order.id), eq(orderOffer.status, "pending"))}
)`.mapWith(Number);

/**
 * Books an order on one of its carrier offers: the single door every
 * booking goes through (creation with an accepted offer, the deal form,
 * and the prospect → booked transition), so the carrier leg and the
 * commission can never depend on which one was used.
 *
 * Returns the columns to fold into the order's own update, the metadata
 * the history row carries, and `settle` — the offer-side writes. They are
 * split because neon-http has no interactive transaction: the caller
 * writes the order row first and settles the offers only once it landed,
 * so a failure leaves a prospect with its offers still pending rather than
 * an accepted offer nothing booked.
 */
export async function acceptOffer(
    db: typeof Database,
    current: Order,
    offer: OrderOffer,
    actor: { userId: string },
    opts?: { note?: string },
): Promise<{ patch: Partial<CreateOrder>; historyOffer: BookedOfferMetadata; settle: () => Promise<void> }> {
    // An offer id from another order would book a carrier that never
    // quoted for this cargo
    if (offer.orderId !== current.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "OFFER_NOT_PENDING" });
    }

    if (offerAcceptable(offer) !== "ok") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "OFFER_NOT_PENDING" });
    }

    // The offer was priced when it was written — its commission and the
    // client price it quotes are what the order is booked at. A row from
    // before pricing existed is priced through the offer dialog first.
    if (offer.commissionTotal === null || offer.clientTotal === null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "OFFER_UNPRICED" });
    }

    const patch: Partial<CreateOrder> = {
        carrierId: offer.carrierId,
        carrierName: offer.carrierName,
        fiscalRegime: offer.fiscalRegime,
        carrierSubtotal: offer.subtotal,
        carrierVAT: offer.vat,
        carrierTotal: offer.total,
        carrierCurrency: offer.currency,
        // The client price the offer quotes becomes the shipper leg, in the
        // offer's currency: the price the shipper was shown is the price the
        // order is booked at, whatever the row carried before
        shipperSubtotal: offer.clientSubtotal,
        shipperVAT: offer.clientVAT,
        shipperTotal: offer.clientTotal,
        shipperCurrency: offer.currency,
        apploadCommissionSubtotal: offer.commissionSubtotal,
        apploadCommissionVAT: offer.commissionVAT,
        apploadCommissionTotal: offer.commissionTotal,
        // A driver and a rig belong to the carrier that named them, so a
        // re-booking with someone else starts from an empty cab
        ...(current.carrierId && current.carrierId !== offer.carrierId && {
            driverId: null,
            driverName: null,
            driverPhoneNumber: null,
            driverPassport: null,
            truckPlate: null,
            trailerPlate: null,
            linkPlate: null,
            truckAge: null,
        }),
    };

    const settle = async () => {
        const now = new Date();

        // One batch, so the winner and the losers are decided together.
        // The second statement sees the first's write, which is why it
        // does not have to exclude the accepted row by id.
        await db.batch([
            db
                .update(orderOffer)
                .set({
                    status: "accepted",
                    decidedAt: now,
                    decidedBy: actor.userId,
                    decisionNote: opts?.note ?? null,
                })
                .where(eq(orderOffer.id, offer.id)),
            db
                .update(orderOffer)
                .set({ status: "lost", decidedAt: now })
                .where(and(eq(orderOffer.orderId, current.id), eq(orderOffer.status, "pending"))),
        ]);
    };

    return { patch, historyOffer: offerMetadata(offer), settle };
}

export type TransitionOrderOutput = {
    orderId: string;
    order: Order;
    warning?: "SHEET_FAILED";
};

/**
 * The one door for status changes, shared by the single-order mutation and
 * the bulk one. Validates the move against the declarative state machine
 * (current status + route + actor role), enforces the payload the move
 * demands (note / evidence / POD), refuses to close a disputed order,
 * stamps implied milestone dates, applies the derived side effects (booked
 * payment scaffolding, dealDate, podStatus...), raises the review flag on
 * risky moves, and appends the history row. Throws TRPCErrors with domain
 * codes; the callers map anything else through toTRPCError.
 *
 * The one door both apps go through: `ctx.actor` says who is asking (the
 * policy in ./policy decides whether that caller owns the move) and
 * `ctx.sheets` says what happens to the logbook — a push the caller
 * supplies, or "defer", which leaves the outbox row to the cron.
 */
export async function applyTransition(
    ctx: OrderContext,
    input: TransitionParams,
): Promise<TransitionOrderOutput> {
    const [current] = await ctx.db
        .select()
        .from(order)
        .where(eq(order.orderId, input.orderId));

    if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
    }

    if (ctx.actor.kind === "staff") {
        // Closing an order as lost (cancelled or underbid) is its own
        // permission on top of transition
        if ((input.to === "cancelled" || input.to === "underbid") && !isAuthorized(ctx.actor.role, "order", ["cancel"])) {
            throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED" });
        }
    } else if (!allowedForActor(ctx.actor, current, input.to, {
        // A partner drives only the stretch of the chain it is
        // responsible for, and only on its own order; every guard below
        // still applies on top
        offerId: input.offerId,
        resumeStatus: current.status === "stopped" || current.status === "issue"
            ? await deriveResumeStatus(ctx.db, current.id)
            : null,
    })) {
        throw new TRPCError({ code: "FORBIDDEN", message: "NOT_ALLOWED_FOR_ACTOR" });
    }

    // What a plan buys: the shipper's booking and the carrier's dispatch. It
    // is asked after the policy, so a partner that does not own the move is
    // told that rather than being sold a plan it does not need. Staff move
    // orders on every plan and on none.
    //
    // Only the first dispatch is asked for: "to-loading" is also where an
    // interrupted trip resumes, and that movement was already billed when it
    // left "booked". A truck parked on the road must not become unmovable
    // because the month ran out or the plan lapsed while it was stopped.
    if (ctx.actor.kind === "tenant"
        && (input.to === "booked" || (input.to === "to-loading" && current.status === "booked"))) {
        await assertTrackingAllowance(ctx.db, ctx.actor.organizationId);
    }

    // Booking a prospect is the acceptance of one of its carrier
    // offers, and nothing else: the carrier, the fiscal regime, the
    // carrier price and the commission are all copied from that offer
    // onto the order. Nothing is written yet — the offers are settled
    // once the row itself has landed.
    let booked: { offer: OrderOffer; accepted: Awaited<ReturnType<typeof acceptOffer>> } | null = null;

    if (input.to === "booked" && current.status === "prospect") {
        if (!input.offerId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "OFFER_REQUIRED" });
        }

        const [offer] = await ctx.db
            .select()
            .from(orderOffer)
            .where(eq(orderOffer.id, input.offerId));

        // A deleted offer reads the same as a decided one: it is no
        // longer awaiting a decision, so it cannot book anything
        if (!offer) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "OFFER_NOT_PENDING" });
        }

        // The offer repoints both legs' currencies; a leg that already
        // carries notes or proofs (a reverted booking) cannot be
        // silently reinterpreted
        await assertCurrencyUnlocked(
            ctx.db,
            { shipperCurrency: offer.currency, carrierCurrency: offer.currency },
            current,
        );

        booked = {
            offer,
            accepted: await acceptOffer(ctx.db, current, offer, { userId: ctx.actor.userId }, { note: input.note }),
        };
    }

    // Driver and truck are optional at booking — a trip is committed
    // weeks before the rig that will run it is known — and mandatory
    // the moment it is dispatched to the loading site
    if (input.to === "to-loading" && !isReadyToDispatch(current)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "INCOMPLETE_FOR_DISPATCH" });
    }

    // The cargo cannot be closed while a dispute over it is open; the
    // dispute is settled or closed first, which lifts this
    if (input.to === "completed" && isActiveDispute(current.disputeStatus)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "DISPUTE_OPEN" });
    }

    // Verification is checked once per thing committed: the carrier at
    // booking, where it comes off the offer because the row does not
    // carry one yet, and the driver and the rig at dispatch, which is
    // the first moment they exist. Later transitions move an order
    // that was already gated on both.
    const { flagPatch: gateFlag } = booked
        ? await guardOrderGate(
            ctx.db,
            { carrierId: booked.offer.carrierId },
            ctx.actor,
            { note: input.note },
        )
        : input.to === "to-loading" && current.carrierId
            ? await guardOrderGate(
                ctx.db,
                {
                    carrierId: current.carrierId,
                    driverId: current.driverId,
                    truckPlate: current.truckPlate,
                    trailerPlate: current.trailerPlate,
                    linkPlate: current.linkPlate,
                },
                ctx.actor,
                { note: input.note },
            )
            : { flagPatch: null };

    const resumeStatus =
        current.status === "stopped" || current.status === "issue"
            ? await deriveResumeStatus(ctx.db, current.id)
            : null;

    const verdict = validateTransition(
        {
            status: current.status,
            route: current.route,
            // A partner is never the admin the terminal reversals demand
            role: ctx.actor.kind === "staff" ? ctx.actor.role : "user",
            resumeStatus,
        },
        input.to,
    );

    if (!verdict.ok) {
        throw new TRPCError({
            code: verdict.code === "NOT_ALLOWED" ? "FORBIDDEN" : "BAD_REQUEST",
            message: verdict.code,
        });
    }

    if (verdict.requirements.includes("note") && !input.note) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "NOTE_REQUIRED" });
    }
    if (verdict.requirements.includes("evidence") && !input.document) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "EVIDENCE_REQUIRED" });
    }
    if (verdict.requirements.includes("pod") && !input.document) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "POD_REQUIRED" });
    }

    const flag = verdict.requirements.includes("flag");
    const stamps = transitionStamps(current, input.to);
    const payments = await paymentSums(ctx.db, current.id);

    // The carrier leg arrives WITH the offer, in this very update, so both
    // derivations have to be told about it rather than read it off the row:
    // `current` is the prospect that had no carrier total — or, on a
    // re-booking, still carries the PREVIOUS carrier's. They price that leg
    // (the booked payment scaffold and the proof block), and the deal-form
    // booking door passes exactly the same pair.
    const bookedCarrier = booked
        ? {
            fiscalRegime: booked.offer.fiscalRegime,
            carrierTotal: Number(booked.offer.total),
            ...(booked.offer.clientTotal !== null && { shipperTotal: Number(booked.offer.clientTotal) }),
        }
        : undefined;

    const [updated] = await ctx.db
        .update(order)
        .set({
            ...stamps,
            status: input.to,
            ...(input.to === "delivered" && current.podStatus === null && {
                podStatus: "pending-collection" as const,
            }),
            // The accepted offer's carrier leg and commission. The derived
            // columns below re-split the same total under the same rule, so
            // they land on identical numbers; what only this patch carries
            // is the carrier identity and the empty cab of a carrier change.
            ...booked?.accepted.patch,
            // A verification flag outranks a transition one: its
            // reason names the specific gap, where the transition
            // flag only carries the operator's note
            ...gateFlag,
            ...(flag && !gateFlag && {
                flaggedForReview: true,
                flagReason: input.note ?? null,
                flaggedAt: new Date(),
                flaggedBy: ctx.actor.userId,
            }),
            // Derived columns (dealDate, payment scaffolding,
            // loaded/offloaded weight, day counters) win last
            ...deriveOrderFields(current, { status: input.to, ...stamps, ...bookedCarrier }),
            // ...except on POP-governed legs, where the recorded
            // proofs beat the booked "pending" scaffold and the
            // prospect/cancelled rules apply to the NEW status
            ...proofPaymentPatch(
                { ...current, status: input.to, ...(booked && { carrierTotal: booked.offer.total, shipperTotal: booked.offer.clientTotal }) },
                payments,
            ),
            version: sql`${order.version} + 1`,
        })
        .where(and(
            eq(order.id, current.id),
            eq(order.version, input.expectedVersion),
        ))
        .returning();

    if (!updated) {
        throw new TRPCError({ code: "CONFLICT", message: "VERSION_CONFLICT" });
    }

    // The offer side of the move, written only now that the row itself
    // landed: a failure here leaves a correct order with stale offer
    // bookkeeping, never a carrier no offer accounts for
    if (booked) {
        await booked.accepted.settle();
    } else if (current.status === "booked" && input.to === "prospect") {
        // Un-booking releases the carrier: its offer is withdrawn, and
        // booking again means accepting a new one. The quotes registered
        // while the order was booked stay `recorded`: they are Appload's
        // data, never candidates, so a replacement carrier is entered as a
        // fresh pending offer on the prospect.
        await ctx.db
            .update(orderOffer)
            .set({
                status: "withdrawn",
                decidedAt: new Date(),
                decidedBy: ctx.actor.userId,
                decisionNote: input.note ?? null,
            })
            .where(and(eq(orderOffer.orderId, current.id), eq(orderOffer.status, "accepted")));
    } else if (current.status === "prospect" && (input.to === "cancelled" || input.to === "underbid")) {
        // The quote died; nobody won it
        await ctx.db
            .update(orderOffer)
            .set({ status: "lost", decidedAt: new Date() })
            .where(and(eq(orderOffer.orderId, current.id), eq(orderOffer.status, "pending")));
    }

    await ctx.db.insert(orderHistory).values({
        orderId: current.id,
        actorUserId: ctx.actor.userId,
        kind: "transition",
        fromStatus: current.status,
        toStatus: input.to,
        metadata: {
            ...(input.note && { note: input.note }),
            ...(flag && { flagged: true }),
            ...(input.document && { document: input.document }),
            ...(booked && { offer: booked.accepted.historyOffer }),
        },
    });

    // Dispatch is the moment tracking starts, so the movement is billed to
    // both parties then — whoever ordered it, Admin included: a partner's
    // month must count the orders staff dispatched on its behalf too.
    if (input.to === "to-loading") {
        await recordTrackingUsage(ctx.db, {
            organizationIds: [updated.shipperId, updated.carrierId],
            entityType: "order",
            entityId: updated.id,
        });
    }

    // The upload that backed the move becomes a first-class
    // document on the order (POD for completion, evidence for
    // cancels), so it shows up in the documents section
    if (input.document && (verdict.requirements.includes("pod") || verdict.requirements.includes("evidence"))) {
        await ctx.db.insert(orderDocument).values({
            orderId: current.id,
            type: verdict.requirements.includes("pod") ? "pod" : "evidence",
            title: input.document.name ?? null,
            url: input.document.url,
            size: input.document.size ?? null,
            mimeType: input.document.mimeType ?? null,
            reason: input.note ?? null,
            uploadedBy: ctx.actor.userId,
        });
    }

    // Booked and tracked orders get a follow-up chat with the
    // driver. Post-response and best-effort: a chat/Infobip
    // failure must never fail the transition. Nothing logs the
    // no-phone skip any more — a booking has no driver yet by
    // design, so the row would land on every single one; the
    // thread opens from order.update when the phone arrives.
    if (FOLLOW_UP_STATUSES.includes(input.to)) {
        const followUp = startFollowUpChat(ctx.db, updated, current.id)
            .catch((error: unknown) => console.error(`follow-up chat failed for ${input.orderId}`, error));

        if (ctx.waitUntil) ctx.waitUntil(followUp); else await followUp;
    }

    // The portal defers the logbook: nothing is pushed, the outbox row
    // is left pending and the existing sheet-sync cron heals it
    if (ctx.sheets === "defer") {
        await recordSheetSync(ctx.db, updated.id, "pending");
    } else {
        try {
            if (!(await ctx.sheets.push(updated)).ok) {
                return { orderId: input.orderId, order: updated, warning: "SHEET_FAILED" };
            }
        } catch (error) {
            // Token acquisition failed — the outbox cron retries with
            // the service account
            console.error(`sheet sync failed on transition for ${input.orderId}`, error);
            return { orderId: input.orderId, order: updated, warning: "SHEET_FAILED" };
        }
    }

    return { orderId: input.orderId, order: updated };
}
