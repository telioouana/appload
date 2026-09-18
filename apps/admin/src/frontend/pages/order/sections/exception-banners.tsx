"use client"

import { IconFlag, IconFlagCheck, IconGavel } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { Link } from "@/i18n/navigation"

import { Button } from "@workspace/ui/components/button"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"

import { parseFlagReason } from "@workspace/domain/kyc/flag-reason"

/** The active dispute as both order surfaces receive it from `order.get`. */
export type OrderDisputeBanner = {
    id: string
    status: string
    reason: string
    holdShipperPayments: boolean
    holdCarrierPayments: boolean
}

/**
 * Why this order's money is frozen, and where to go about it. Shared by the
 * details page and the order panel — they showed the same thing through two
 * copies before, which is how they drifted on which queries a resolved flag
 * invalidates.
 */
export function DisputeBanner({ dispute }: { dispute: OrderDisputeBanner }) {
    const t = useTranslations("Admin.orders.dispute")
    const tValues = useTranslations("Admin.disputes.values")

    const holds = [
        dispute.holdShipperPayments && tValues("hold-shipper"),
        dispute.holdCarrierPayments && tValues("hold-carrier"),
    ].filter(Boolean).join(" · ")

    return (
        <Alert variant="destructive">
            <IconGavel />
            <AlertTitle>
                {t("banner-title", {
                    reason: tValues(`reasons.${dispute.reason}` as never),
                    status: tValues(`statuses.${dispute.status}` as never),
                })}
            </AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
                <span>{holds || t("banner-no-holds")}</span>
                <Link
                    href={{ pathname: "/orders/disputes", query: { id: dispute.id } }}
                    className="w-fit font-medium underline-offset-4 hover:underline"
                >
                    {t("banner-link")}
                </Link>
            </AlertDescription>
        </Alert>
    )
}

/**
 * The review flag, with its one action. The caller owns the mutation — the
 * page and the panel invalidate different query sets after it — so this
 * takes the handler, its pending state and the permission as props rather
 * than deciding any of them.
 *
 * The reason is stored as a code (see `gateFlagReason`) and worded here:
 * "Booked with a carrier that had no approved signed contract — accepted
 * for one trip", the operator's note quoted after the dash.
 */
export function FlagBanner({
    reason,
    canResolve,
    resolving,
    onResolve,
}: {
    reason: string | null
    canResolve: boolean
    resolving: boolean
    onResolve: () => void
}) {
    const t = useTranslations("Admin.orders.detailPage")

    const parsed = reason ? parseFlagReason(reason) : null
    const text = !parsed
        ? t("flagged.noReason")
        : parsed.code === null
            ? parsed.note
            : [
                parsed.detail
                    ? `${t(`flagged.reasons.${parsed.code}`)}: ${parsed.detail}`
                    : t(`flagged.reasons.${parsed.code}`),
                parsed.note,
            ].filter(Boolean).join(" — ")

    return (
        <Alert variant="destructive">
            <IconFlag />
            <AlertTitle>{t("flagged.title")}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
                <span>{text}</span>
                {canResolve && (
                    <Button size="sm" variant="outline" className="w-fit" disabled={resolving} onClick={onResolve}>
                        <IconFlagCheck />
                        {t("flagged.resolve")}
                    </Button>
                )}
            </AlertDescription>
        </Alert>
    )
}
