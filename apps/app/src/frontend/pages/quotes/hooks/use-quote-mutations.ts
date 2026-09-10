"use client"

import { toast } from "sonner"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { planRefusal } from "@/components/plan-dialog"
import { domainErrorCode } from "@/lib/trpc-error"

/**
 * Every domain code the quotes procedures raise, mapped to the message key
 * that explains it. One table, so a toast and a dialog say the same thing
 * about the same failure.
 *
 * The last group comes from the shared create door: accepting a quote books
 * an order, and booking runs Appload's verification gate on the carrier.
 */
export const QUOTE_ERROR_KEYS = {
    NOT_FOUND: "notFound",
    QUOTE_NOT_SENT: "notSent",
    ALREADY_DECIDED: "alreadyDecided",
    QUOTE_EXPIRED: "expired",
    LOADING_DATE_REQUIRED: "loadingDate",
    CLIENT_NOT_CONNECTED: "clientNotConnected",
    NOT_ALLOWED: "notAllowed",
    NOT_ALLOWED_FOR_ACTOR: "notAllowed",
    WRONG_ORGANIZATION_TYPE: "notAllowed",
    SUBSCRIPTION_REQUIRED: "subscription",
    QUOTA_EXCEEDED: "quotaExceeded",
    CARRIER_NOT_VERIFIED: "carrierNotVerified",
    CARRIER_CONTRACT_MISSING: "carrierContractMissing",
    CARRIER_CONTRACT_EXPIRED: "carrierContractExpired",
    CARRIER_SUSPENDED: "carrierSuspended",
    RISK_REVIEW_REQUIRED: "riskReview",
    UNKNOWN: "unknown",
} as const

export type QuoteErrorCode = keyof typeof QUOTE_ERROR_KEYS

export const QUOTE_ERROR_CODES = Object.keys(QUOTE_ERROR_KEYS) as QuoteErrorCode[]

/** The domain code an error carries, narrowed to the ones with an explanation. */
export const quoteErrorCode = (error: unknown): QuoteErrorCode =>
    domainErrorCode(error, QUOTE_ERROR_CODES, "UNKNOWN")

/**
 * The four quote mutations the list, the panel and the dialogs share.
 *
 * Every success refreshes the whole quotes tree — a decision moves a row
 * between statuses and changes two of the three tiles — and an acceptance
 * also refreshes the orders tree, because that is where the new order landed.
 */
export function useQuoteMutations() {
    const t = useTranslations("App.quotes")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.quotes.pathKey() })

    const fail = (error: unknown) => toast.error(t(`errors.${QUOTE_ERROR_KEYS[quoteErrorCode(error)]}`))

    const create = useMutation(trpc.quotes.create.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("toasts.created")) },
        onError: fail,
    }))

    const withdraw = useMutation(trpc.quotes.withdraw.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("toasts.withdrawn")) },
        onError: fail,
    }))

    const decline = useMutation(trpc.quotes.decline.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("toasts.declined")) },
        onError: fail,
    }))

    const accept = useMutation(trpc.quotes.accept.mutationOptions({
        onSuccess: (data) => {
            void refresh()
            void queryClient.invalidateQueries({ queryKey: trpc.orders.pathKey() })
            toast.success(t("toasts.accepted", { orderId: data.orderId }))
        },
        // A plan refusal is answered by the dialog the form opens; a toast
        // saying the same thing would only land on top of it
        onError: (error) => { if (planRefusal(error) === null) fail(error) },
    }))

    return { create, withdraw, decline, accept, refresh }
}
