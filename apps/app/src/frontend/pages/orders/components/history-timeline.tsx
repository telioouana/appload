"use client"

import { IconArrowRight, IconFileDollar, IconFileText, IconGavel } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"

import { money } from "@/frontend/pages/orders/lib/format"
import type { OrderHistoryEntry } from "@/frontend/pages/orders/types"

const KIND_ICON = {
    transition: IconArrowRight,
    offer: IconFileDollar,
    document: IconFileText,
    dispute: IconGavel,
} as const

/**
 * What has happened to this order, newest first: status changes as from→to
 * chips, quotes with the price in the reader's OWN money, uploads and
 * disputes as one-liners.
 *
 * Unlike Admin's timeline there is no metadata to read here — the procedure
 * projects every field this renders, and rows about another carrier's quote
 * never arrive — so nothing on this page can leak by being forwarded raw.
 */
export function HistoryTimeline({ entries }: { entries: OrderHistoryEntry[] }) {
    const t = useTranslations("App.orders.timeline")
    const tStatus = useTranslations("App.orders.status")
    const tDocument = useTranslations("App.orders.documents.types")
    const f = useFormatter()

    // An offer row names its own line through the action it carries, and the
    // typed signature only takes literal keys — checked with `has` before use
    const line = t as unknown as (key: string, values: Record<string, string>) => string

    if (entries.length === 0) {
        return <p className="text-muted-foreground py-2 text-sm">{t("empty")}</p>
    }

    return (
        <ol className="flex flex-col">
            {entries.map((entry, index) => {
                const Icon = KIND_ICON[entry.kind as keyof typeof KIND_ICON] ?? IconArrowRight

                // "Quoted by Transportes Tembe · 120,000 MZN", or on the
                // booking transition "Booked with …". An action with no copy
                // of its own is skipped rather than rendered as a missing key
                const offerKey = entry.kind === "transition" ? "offer.booked" : `offer.${entry.action}`
                const offerLine = entry.offer && (entry.kind === "transition" || entry.action) && t.has(offerKey)
                    ? line(offerKey, {
                        carrier: entry.offer.carrierName,
                        amount: money(f, entry.offer.total, entry.offer.currency) ?? "",
                    })
                    : null

                return (
                    <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
                        {index < entries.length - 1 && (
                            <span aria-hidden className="bg-border absolute top-7 left-[13px] h-[calc(100%-1.75rem)] w-px" />
                        )}

                        <span className="bg-muted/50 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border">
                            <Icon className="text-muted-foreground size-3.5" stroke={1.5} />
                        </span>

                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                                {entry.kind === "transition" ? (
                                    <span className="flex flex-wrap items-center gap-1.5">
                                        {entry.fromStatus
                                            ? <Badge variant="outline">{tStatus(entry.fromStatus)}</Badge>
                                            : <span className="text-muted-foreground">{t("created")}</span>}
                                        {entry.fromStatus && entry.toStatus && (
                                            <IconArrowRight className="text-muted-foreground size-3.5" />
                                        )}
                                        {entry.toStatus && <Badge>{tStatus(entry.toStatus)}</Badge>}
                                    </span>
                                ) : (
                                    <span className="flex flex-wrap items-center gap-1.5">
                                        <span className="font-medium">{t(`kinds.${entry.kind}`)}</span>
                                        {entry.documentType && (
                                            <Badge variant="outline">{tDocument(entry.documentType)}</Badge>
                                        )}
                                    </span>
                                )}
                            </div>

                            {offerLine && <p className="text-muted-foreground text-sm">{offerLine}</p>}

                            {entry.note && <p className="text-muted-foreground text-sm">{entry.note}</p>}

                            <p className="text-muted-foreground/70 text-xs">
                                {f.dateTime(entry.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                                {entry.actorName ? ` · ${entry.actorName}` : ` · ${t("system")}`}
                            </p>
                        </div>
                    </li>
                )
            })}
        </ol>
    )
}
