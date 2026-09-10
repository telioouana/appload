"use client"

import { toast } from "sonner"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { domainErrorCode } from "@/lib/trpc-error"

/**
 * Every domain code the partners procedures raise, mapped to the message key
 * that explains it. One table, so a toast and a form field say the same thing
 * about the same failure.
 */
export const PARTNER_ERROR_KEYS = {
    NOT_FOUND: "notFound",
    ALREADY_CONNECTED: "alreadyConnected",
    ALREADY_PENDING: "alreadyPending",
    SELF_CONNECTION: "selfConnection",
    WRONG_PARTNER_TYPE: "wrongPartnerType",
    RELATION_NOT_ALLOWED: "relationNotAllowed",
    NOT_ALLOWED: "notAllowed",
    DUPLICATE_NUIT: "duplicateNuit",
    DUPLICATE_EMAIL: "duplicateEmail",
    DUPLICATE_PHONE: "duplicatePhone",
    RATE_LIMITED: "rateLimited",
    UNKNOWN: "unknown",
} as const

export type PartnerErrorCode = keyof typeof PARTNER_ERROR_KEYS

export const PARTNER_ERROR_CODES = Object.keys(PARTNER_ERROR_KEYS) as PartnerErrorCode[]

/** The domain code an error carries, narrowed to the ones with an explanation. */
export const partnerErrorCode = (error: unknown): PartnerErrorCode =>
    domainErrorCode(error, PARTNER_ERROR_CODES, "UNKNOWN")

/**
 * The four connection mutations the list, the requests tab and the profile
 * panel share. Each refreshes every partners query on success: answering a
 * request moves a row between tabs and changes two of the three tiles, so
 * the counts and the lists have to refetch together.
 */
export function usePartnerMutations() {
    const t = useTranslations("App.partners")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.partners.pathKey() })

    const fail = (error: unknown) => toast.error(t(`errors.${PARTNER_ERROR_KEYS[partnerErrorCode(error)]}`))

    const request = useMutation(trpc.partners.request.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("toasts.requested")) },
        onError: fail,
    }))

    const respond = useMutation(trpc.partners.respond.mutationOptions({
        onSuccess: (data) => {
            void refresh()
            toast.success(t(data.status === "accepted" ? "toasts.accepted" : "toasts.declined"))
        },
        onError: fail,
    }))

    const remove = useMutation(trpc.partners.remove.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("toasts.removed")) },
        onError: fail,
    }))

    const withdraw = useMutation(trpc.partners.withdraw.mutationOptions({
        onSuccess: () => { void refresh(); toast.success(t("toasts.withdrawn")) },
        onError: fail,
    }))

    return { request, respond, remove, withdraw, refresh }
}
