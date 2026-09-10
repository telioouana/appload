"use client"

import {
    IconArrowBackUp,
    IconCheck,
    IconDotsVertical,
    IconEdit,
    IconMapPin,
    IconPlus,
    IconShieldCheck,
    IconTrash,
    IconX,
} from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"
import type { Order } from "@workspace/db/orders"
import type { OfferStatus } from "@workspace/db/types"

import { cn } from "@workspace/ui/lib/utils"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { initials } from "@workspace/ui/customs/list/table-cells"
import { KycBadge } from "@/frontend/pages/partners/sections/badges"
import type { OfferRow } from "@/frontend/pages/order/server/offers-procedures"

import { SectionCard } from "./section-card"

type OffersListProps = {
    order: Order
    offers: OfferRow[]
    /** The list without its controls — for a viewer who cannot change the order */
    readOnly?: boolean
    onAdd?: () => void
    onAccept?: (offer: OfferRow) => void
    onEdit?: (offer: OfferRow) => void
    onDecide?: (offer: OfferRow, status: "declined" | "withdrawn") => void
    onRemove?: (offer: OfferRow) => void
}

/**
 * What the carriers quoted for this trip. On a prospect these are live
 * candidates — accepting one is what books the order — and from booked
 * onward they are Appload's own record of what the market offered, which
 * is why the card says so and offers no Accept.
 *
 * The rows come back in the server's order (accepted first, then the
 * cheapest pending) and are never re-sorted here: the comparison the
 * operator is making has to look the same wherever it is shown.
 */
export function OffersCard(props: OffersListProps) {
    const t = useTranslations("Admin.orders.offers")

    return (
        <SectionCard
            title={t("card.title")}
            count={props.offers.length}
            actions={!props.readOnly && props.onAdd ? (
                <Button size="sm" variant="outline" onClick={props.onAdd}>
                    <IconPlus />
                    {t("actions.add")}
                </Button>
            ) : undefined}
        >
            <OffersList {...props} />
        </SectionCard>
    )
}

export function OffersList({
    order,
    offers,
    readOnly = false,
    onAdd,
    onAccept,
    onEdit,
    onDecide,
    onRemove,
}: OffersListProps) {
    const t = useTranslations("Admin.orders.offers")
    // The regime labels live with the offer form that names them
    const tRegime = useTranslations("Admin.orders.offers.form.fiscalRegime.options")
    const tActions = useTranslations("Admin.orders.list.actions")
    const f = useFormatter()

    const prospect = order.status === "prospect"
    const accepted = offers.some((offer) => offer.status === "accepted")

    // A booking made before offers existed (or restored by an admin
    // reversal) still carries its carrier leg on the order row, and that
    // leg is the booking — so it leads the list, read-only
    const legacyBooking = !prospect && !accepted && order.carrierId !== null

    if (offers.length === 0 && !legacyBooking) {
        return (
            <div className="flex flex-col items-start gap-3 py-2">
                <p className="text-muted-foreground text-sm">{t("card.empty")}</p>
                {!readOnly && onAdd && (
                    <Button size="sm" variant="outline" onClick={onAdd}>
                        <IconPlus />
                        {t("actions.add")}
                    </Button>
                )}
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-3">
            <ul className="flex flex-col divide-y">
                {legacyBooking && (
                    <Row
                        name={order.carrierName ?? "—"}
                        price={money(f, order.carrierTotal, order.carrierCurrency)}
                        caption={t("card.bookedWith")}
                    />
                )}

                {offers.map((offer) => {
                    const canAccept = prospect && offer.status === "pending" && !readOnly && onAccept !== undefined
                    const editable = offer.status === "pending" || offer.status === "recorded"

                    return (
                        <Row
                            key={offer.id}
                            highlight={offer.status === "accepted"}
                            name={offer.carrierName}
                            price={money(f, offer.clientTotal ?? offer.total, offer.currency)}
                            caption={tRegime(offer.fiscalRegime)}
                            extra={offer.clientTotal !== null && offer.commissionTotal !== null ? (
                                <span className={cn("text-[11px] tabular-nums", Number(offer.commissionTotal) < 0 ? "text-destructive" : "text-muted-foreground")}>
                                    {t("commission.carrier")} {money(f, offer.total, offer.currency)}
                                    {" · "}
                                    {t("commission.short")} {money(f, offer.commissionTotal, offer.currency)}
                                </span>
                            ) : (
                                <span className="text-destructive text-[11px]">{t("commission.unpriced")}</span>
                            )}
                            badges={
                                <>
                                    {offer.carrierKycStatus && offer.carrierKycStatus !== "verified" && (
                                        <KycBadge status={offer.carrierKycStatus} />
                                    )}
                                    <OfferStatusBadge status={offer.status} />
                                </>
                            }
                            meta={
                                <>
                                    <IncludesChips git={offer.includesGit} gps={offer.includesGps} />
                                    <span aria-hidden>·</span>
                                    <span className="whitespace-nowrap">{snapshot(t, f, offer)}</span>
                                    {offer.notes && (
                                        <>
                                            <span aria-hidden>·</span>
                                            <span className="min-w-0 truncate">{offer.notes}</span>
                                        </>
                                    )}
                                </>
                            }
                            actions={
                                <>
                                    {canAccept && (
                                        <Button size="sm" variant="outline" onClick={() => onAccept?.(offer)}>
                                            <IconCheck />
                                            {t("actions.accept")}
                                        </Button>
                                    )}

                                    {!readOnly && editable && (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button size="icon-sm" variant="ghost" aria-label={tActions("menu")}>
                                                    <IconDotsVertical />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="w-44">
                                                {onEdit && (
                                                    <DropdownMenuItem onSelect={() => onEdit(offer)}>
                                                        <IconEdit stroke={1.5} />
                                                        {t("actions.edit")}
                                                    </DropdownMenuItem>
                                                )}

                                                {onDecide && offer.status === "pending" && (
                                                    <>
                                                        <DropdownMenuItem onSelect={() => onDecide(offer, "declined")}>
                                                            <IconX stroke={1.5} />
                                                            {t("actions.decline")}
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onSelect={() => onDecide(offer, "withdrawn")}>
                                                            <IconArrowBackUp stroke={1.5} />
                                                            {t("actions.withdraw")}
                                                        </DropdownMenuItem>
                                                    </>
                                                )}

                                                {onRemove && (
                                                    <>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem variant="destructive" onSelect={() => onRemove(offer)}>
                                                            <IconTrash stroke={1.5} />
                                                            {t("actions.remove")}
                                                        </DropdownMenuItem>
                                                    </>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    )}
                                </>
                            }
                        />
                    )
                })}
            </ul>

            {!prospect && <p className="text-muted-foreground text-xs italic">{t("card.recordedHint")}</p>}
        </div>
    )
}

/**
 * One quote: who, what it covers and what it costs the client — the
 * carrier's own price and Appload's cut read underneath. The accepted one is
 * lifted out of the list — it is not a candidate any more, it is the
 * booking — so it reads as a state rather than as one row among equals.
 */
function Row({
    name,
    price,
    caption,
    badges,
    meta,
    actions,
    extra,
    highlight = false,
}: {
    name: string
    price: string | null
    caption: string
    /** Under the caption: the carrier's own price and Appload's commission behind the client price */
    extra?: React.ReactNode
    badges?: React.ReactNode
    meta?: React.ReactNode
    actions?: React.ReactNode
    highlight?: boolean
}) {
    return (
        <li className={cn(
            "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 py-3 first:pt-0 last:pb-0",
            highlight && "bg-primary/5 ring-primary/20 -mx-2 rounded-xl px-2 ring-1",
        )}>
            <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                {initials(name)}
            </span>

            <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{name}</span>
                    {badges}
                </div>

                {meta && (
                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                        {meta}
                    </div>
                )}
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="text-sm font-medium tabular-nums">
                    {price ?? <span className="text-muted-foreground/60 font-normal">—</span>}
                </span>
                <span className="text-muted-foreground text-[11px]">{caption}</span>
                {extra}
                {actions && <div className="flex items-center gap-1">{actions}</div>}
            </div>
        </li>
    )
}

/** What the quote covers — an excluded cover is stated, not left out. */
export function IncludesChips({ git, gps }: { git: boolean; gps: boolean }) {
    const t = useTranslations("Admin.orders.offers.includes")

    return (
        <span className="flex items-center gap-1">
            <IncludeChip included={git} label={t("git")} icon={<IconShieldCheck className="size-3" />} />
            <IncludeChip included={gps} label={t("gps")} icon={<IconMapPin className="size-3" />} />
        </span>
    )
}

function IncludeChip({ included, label, icon }: { included: boolean; label: string; icon: React.ReactNode }) {
    return (
        <Badge variant="outline" className={cn("gap-1", !included && "text-muted-foreground/60 line-through")}>
            {icon}
            {label}
        </Badge>
    )
}

function OfferStatusBadge({ status }: { status: OfferStatus }) {
    const t = useTranslations("Admin.orders.offers.status")

    return (
        <Badge
            variant="outline"
            className={cn(
                "gap-1",
                status === "accepted" ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                    : status === "pending" ? "border-primary/40 text-primary"
                        : "text-muted-foreground",
            )}
        >
            {status === "accepted" && <IconCheck className="size-3" />}
            {t(status)}
        </Badge>
    )
}

/** "With Appload since Mar 2023 · 42 trips" — the carrier's record when the offer was written. */
export function snapshot(
    t: ReturnType<typeof useTranslations<"Admin.orders.offers">>,
    f: ReturnType<typeof useFormatter>,
    offer: { carrierSince: Date | null; carrierTrips: number | null },
) {
    return offer.carrierSince
        ? t("snapshot", {
            date: f.dateTime(offer.carrierSince, { month: "short", year: "numeric" }),
            trips: offer.carrierTrips ?? 0,
        })
        : t("snapshotUnknown")
}

/** The stored numeric next to its currency, as every money figure on this page reads. */
export function money(f: ReturnType<typeof useFormatter>, total: string | null, currency: string | null) {
    return total === null ? null : `${f.number(Number(total), { maximumFractionDigits: 0 })} ${currency ?? "MZN"}`
}
