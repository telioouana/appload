import { z } from "zod";

import { LOADING_CHECK_ITEM, type LoadingCheckOutcome } from "@workspace/db/types";
import type { LoadingCheckItemRow, OrderLoadingCheck } from "@workspace/db/orders";
import { isAuthorized } from "@workspace/auth/user-permissions";

import type { Actor } from "@workspace/domain/orders/actor";

/**
 * The loading check: the orderer's confirmation, before the load starts,
 * that the truck and the driver who turned up are the ones the dispatch
 * pack names.
 *
 * Pure and client-safe — the cards in both apps render from these rules and
 * the shared transition door enforces them, so what the operator is shown
 * and what the server does are the same decision. The rows themselves are
 * read and written in ./loading-check-store.
 */

/** What is confirmed, in the order the cards render it. */
export const LOADING_CHECK_ITEMS = LOADING_CHECK_ITEM;

/** One answered (or deliberately unanswered) item, as it is stored. */
export type LoadingCheckItemResult = LoadingCheckItemRow;

/**
 * What a set of answers comes to. An item left untouched is not a pass —
 * an unanswered question never confirmed anything — so only a complete set
 * of yeses passes, and a single no is a mismatch whatever the rest say.
 */
export function deriveOutcome(items: LoadingCheckItemResult[]): LoadingCheckOutcome {
    if (items.some((item) => item.ok === false)) {
        return "mismatch";
    }

    return LOADING_CHECK_ITEMS.every((key) => items.find((item) => item.key === key)?.ok === true)
        ? "passed"
        : "skipped";
}

/**
 * Where an order stands on the check. "partial" is a check that was
 * recorded but left something unanswered: the pack was looked at, and the
 * load still starts unchecked.
 */
export type LoadingCheckState = {
    state: "none" | "passed" | "mismatch" | "partial";
    check: OrderLoadingCheck | null;
};

/**
 * What moving to "loading" demands of this actor, given what the check
 * says. A flag never blocks on its own (Claire's rule): the only refusals
 * here are the manager gate — a mismatch is a supervisory decision, and a
 * partner has no supervisory role to take it with.
 */
export type LoadingMoveRequirements = {
    blocked: "LOADING_MISMATCH_REVIEW_REQUIRED" | "MANAGER_REQUIRED" | null;
    /** The manager has to say why the load went ahead anyway */
    note: boolean;
    /** The move proceeds, and the order is flagged LOADING_CHECK_SKIPPED */
    skippedFlag: boolean;
};

const NOTHING: LoadingMoveRequirements = { blocked: null, note: false, skippedFlag: false };

export function loadingMoveRequirements(state: LoadingCheckState, actor: Actor): LoadingMoveRequirements {
    if (state.state === "mismatch") {
        // The carrier is read-only on the check, and never clears a
        // mismatch about its own truck: the load waits for Appload
        if (actor.kind === "tenant") {
            return { ...NOTHING, blocked: "LOADING_MISMATCH_REVIEW_REQUIRED" };
        }

        // The same manager proxy `guardOrderGate` accepts risks with
        if (!isAuthorized(actor.role, "risk", ["flag"])) {
            return { ...NOTHING, blocked: "MANAGER_REQUIRED" };
        }

        return { ...NOTHING, note: true };
    }

    if (state.state === "passed") {
        return NOTHING;
    }

    // Nobody checked, or the check was left half done: the truck loads and
    // the order carries the fact
    return { ...NOTHING, skippedFlag: true };
}

/** What recording a check carries. */
export const LoadingCheckInputSchema = z.object({
    orderId: z.string().nonempty(),
    expectedVersion: z.number().int().min(1),
    items: z
        .array(z.object({
            key: z.enum(LOADING_CHECK_ITEM),
            ok: z.boolean().nullable(),
            note: z.string().trim().max(500).optional(),
        }))
        .length(LOADING_CHECK_ITEM.length)
        // Exactly the two items, each once: a payload that answers one of
        // them twice would derive an outcome from half the checklist
        .refine((items) => LOADING_CHECK_ITEM.every((key) => items.some((item) => item.key === key))),
    note: z.string().trim().max(2000).optional(),
    /** `order_document` ids of the photos taken at the site */
    photoDocumentIds: z.array(z.string().nonempty()).max(10).default([]),
});

export type LoadingCheckInput = z.infer<typeof LoadingCheckInputSchema>;
