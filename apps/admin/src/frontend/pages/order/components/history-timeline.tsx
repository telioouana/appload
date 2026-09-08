"use client"

import { useState } from "react"
import {
    IconArrowRight,
    IconCash,
    IconChevronDown,
    IconFileDollar,
    IconFileText,
    IconFlag,
    IconGavel,
    IconPencil,
    IconReceipt,
    IconRobot,
} from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"
import type { OrderHistoryKind } from "@workspace/db/orders"

import { cn } from "@workspace/ui/lib/utils"
import { Badge } from "@workspace/ui/components/badge"

export type HistoryEntry = {
    id: string
    kind: OrderHistoryKind
    fromStatus: string | null
    toStatus: string | null
    changedFields: Record<string, { from: unknown; to: unknown }> | null
    metadata: Record<string, unknown>
    createdAt: Date
    actorName: string | null
}

const KIND_ICON: Record<OrderHistoryKind, typeof IconArrowRight> = {
    "transition": IconArrowRight,
    "update": IconPencil,
    "document": IconFileText,
    "note": IconReceipt,
    "payment": IconCash,
    "flag": IconFlag,
    "dispute": IconGavel,
    "offer": IconFileDollar,
    "system": IconRobot,
}

/** A dispute row's metadata: the action, the cause and the state, all enum codes. */
function readDispute(metadata: Record<string, unknown>) {
    const text = (value: unknown) => (typeof value === "string" ? value : null)
    return {
        action: text(metadata.action),
        reason: text(metadata.reason),
        status: text(metadata.status),
        resolution: text(metadata.resolution),
        holdShipper: metadata.holdShipperPayments === true,
        holdCarrier: metadata.holdCarrierPayments === true,
    }
}

/**
 * Carrier offers reach the timeline twice: an `offer` row carries the facts
 * at the top of its metadata (with the action it describes), and the
 * transition row that books an order carries the same facts nested under
 * `metadata.offer`. Both are read through here, defensively — the jsonb
 * column is untyped, so a legacy or malformed row degrades to a bare title.
 */
function readOffer(source: Record<string, unknown> | null) {
    if (!source) return null

    const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value : null)
    const total = typeof source.total === "number" || typeof source.total === "string" ? Number(source.total) : null

    return {
        action: text(source.action),
        carrierName: text(source.carrierName),
        total: total !== null && Number.isFinite(total) ? total : null,
        currency: text(source.currency),
    }
}

const record = (value: unknown) =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null

const display = (value: unknown) =>
    value === null || value === undefined || value === "" ? "—" : String(value)

type PaymentParty = "shipper" | "carrier"

/**
 * Proof-of-payment rows carry their figures in metadata (documentId, party,
 * total, currency, paidAt as ISO, reason?, voided?, replacedManual?). The
 * jsonb column is untyped, so every field is checked before use — a
 * malformed row degrades to a bare title instead of a crash.
 */
function readPayment(metadata: Record<string, unknown>) {
    const party = metadata.party === "shipper" || metadata.party === "carrier"
        ? (metadata.party as PaymentParty)
        : null
    const total = typeof metadata.total === "number" || typeof metadata.total === "string"
        ? Number(metadata.total)
        : null
    const currency = typeof metadata.currency === "string" ? metadata.currency : null
    const paidAtRaw = typeof metadata.paidAt === "string" ? new Date(metadata.paidAt) : null
    const paidAt = paidAtRaw && !Number.isNaN(paidAtRaw.getTime()) ? paidAtRaw : null
    const reason = typeof metadata.reason === "string" && metadata.reason.trim() !== "" ? metadata.reason : null
    const voided = metadata.voided === true
    // Notes only: the direction — the one fact that says whether the
    // effective total went up (debit) or down (credit)
    const noteType: "debit-note" | "credit-note" | null =
        metadata.type === "debit-note" || metadata.type === "credit-note" ? metadata.type : null
    // Notes only: the structured cause and, for demurrage, its stage/days
    const reasonCode = typeof metadata.reasonCode === "string" ? metadata.reasonCode : null
    const details = typeof metadata.details === "object" && metadata.details !== null
        ? (metadata.details as { stage?: unknown; days?: unknown })
        : null
    const stage = typeof details?.stage === "string" ? details.stage : null
    const days = typeof details?.days === "number" ? details.days : null

    const replaced = metadata.replacedManual
    const replacedAmount =
        typeof replaced === "object" && replaced !== null && "paidAmount" in replaced
            ? (replaced as { paidAmount: unknown }).paidAmount
            : null
    const replacedManual =
        typeof replacedAmount === "number" || typeof replacedAmount === "string"
            ? Number(replacedAmount)
            : null

    return {
        party,
        total: total !== null && Number.isFinite(total) ? total : null,
        currency,
        paidAt,
        reason,
        voided,
        noteType,
        reasonCode,
        stage,
        days,
        replacedManual: replacedManual !== null && Number.isFinite(replacedManual) ? replacedManual : null,
    }
}

/**
 * The order's audit trail, newest first: transitions as from→to chips,
 * updates as expandable field diffs, documents/notes/flags/system events
 * as one-liners with their metadata, payments as a party · amount · date
 * summary.
 */
export function HistoryTimeline({ entries }: { entries: HistoryEntry[] }) {
    const t = useTranslations("Admin.orders.history")
    const tStatus = useTranslations("Admin.orders.header.filters.status.options")
    // Party, reason and stage labels live with the documents card, which
    // already names them
    const tParty = useTranslations("Admin.orders.documents.parties")
    const tType = useTranslations("Admin.orders.documents.types")
    const tReason = useTranslations("Admin.orders.documents.reasons")
    const tStage = useTranslations("Admin.orders.documents.stages")
    const tDispute = useTranslations("Admin.disputes.values")
    // An offer row names its own message through its action, and the typed
    // signature only takes literal keys — checked with t.has before use
    const tOffer = t as unknown as (key: string, values: Record<string, string>) => string
    const f = useFormatter()

    const [expanded, setExpanded] = useState<Set<string>>(new Set())

    if (entries.length === 0) {
        return <p className="py-4 text-sm text-muted-foreground">{t("empty")}</p>
    }

    function toggle(id: string) {
        setExpanded((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id); else next.add(id)
            return next
        })
    }

    return (
        <ol className="flex flex-col">
            {entries.map((entry, index) => {
                const Icon = KIND_ICON[entry.kind]
                const isOpen = expanded.has(entry.id)
                const fields = entry.changedFields ? Object.entries(entry.changedFields) : []
                const note = typeof entry.metadata.note === "string" ? entry.metadata.note : null
                // Payments and financial notes share the metadata shape
                const payment = entry.kind === "payment" || entry.kind === "note" ? readPayment(entry.metadata) : null

                const offer = entry.kind === "offer"
                    ? readOffer(entry.metadata)
                    : entry.kind === "transition" ? readOffer(record(entry.metadata.offer)) : null
                // "Offer from Transportes Tembe · 120,000 MZN declined", or
                // on the booking transition "Booked with … · …". The action
                // comes from the row, so an unknown one is skipped rather
                // than rendered as a missing key
                const offerKey = entry.kind === "transition" ? "offer.booked" : `offer.${offer?.action}`
                const offerLine = offer && offer.carrierName && (entry.kind === "transition" || offer.action) && t.has(offerKey)
                    ? tOffer(offerKey, {
                        carrier: offer.carrierName,
                        amount: offer.total !== null
                            ? [f.number(offer.total, { maximumFractionDigits: 0 }), offer.currency].filter(Boolean).join(" ")
                            : "",
                    })
                    : null

                // Payment: party · amount currency · payment date (· reference).
                // Note: party · amount currency · reason (· stage · days) ·
                // description. Each piece is optional so a partial (or legacy)
                // row still reads sensibly
                const paymentSummary = payment
                    ? [
                        payment.party ? tParty(payment.party) : null,
                        payment.total !== null
                            ? [f.number(payment.total, { maximumFractionDigits: 2 }), payment.currency].filter(Boolean).join(" ")
                            : null,
                        payment.paidAt ? f.dateTime(payment.paidAt, { dateStyle: "medium" }) : null,
                        payment.reasonCode ? tReason(payment.reasonCode as never) : null,
                        payment.stage ? tStage(payment.stage as never) : null,
                        payment.days !== null ? `${payment.days}d` : null,
                        payment.reason,
                    ].filter((part): part is string => !!part).join(" · ")
                    : null

                return (
                    <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
                        {index < entries.length - 1 && (
                            <span aria-hidden className="absolute top-7 left-[13px] h-[calc(100%-1.75rem)] w-px bg-border" />
                        )}

                        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-muted/50">
                            <Icon className="size-3.5 text-muted-foreground" />
                        </span>

                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                                {entry.kind === "transition" ? (
                                    <span className="flex flex-wrap items-center gap-1.5">
                                        {entry.fromStatus
                                            ? <Badge variant="outline">{tStatus(entry.fromStatus as never)}</Badge>
                                            : <span className="text-muted-foreground">{t("created")}</span>}
                                        {entry.fromStatus && entry.toStatus && <IconArrowRight className="size-3.5 text-muted-foreground" />}
                                        {entry.toStatus && <Badge>{tStatus(entry.toStatus as never)}</Badge>}
                                        {entry.metadata.flagged === true && (
                                            <Badge variant="destructive" className="gap-1">
                                                <IconFlag className="size-3" />
                                                {t("flagged")}
                                            </Badge>
                                        )}
                                    </span>
                                ) : entry.kind === "payment" || entry.kind === "note" ? (
                                    <span className="flex flex-wrap items-center gap-1.5">
                                        <span className="font-medium">{t(`kinds.${entry.kind}`)}</span>
                                        {payment?.noteType && <Badge variant="outline">{tType(payment.noteType)}</Badge>}
                                        {payment?.voided && <Badge variant="destructive">{t("voided")}</Badge>}
                                    </span>
                                ) : entry.kind === "dispute" ? (
                                    (() => {
                                        const dispute = readDispute(entry.metadata)
                                        return (
                                            <span className="flex flex-wrap items-center gap-1.5">
                                                <span className="font-medium">
                                                    {dispute.action ? tDispute(`actions.${dispute.action}` as never) : t("kinds.dispute")}
                                                </span>
                                                {dispute.reason && <Badge variant="outline">{tDispute(`reasons.${dispute.reason}` as never)}</Badge>}
                                                {dispute.status && <Badge variant={dispute.status === "open" || dispute.status === "under-review" ? "destructive" : "secondary"}>{tDispute(`statuses.${dispute.status}` as never)}</Badge>}
                                                {dispute.action !== "resolved" && (dispute.holdShipper || dispute.holdCarrier) && (
                                                    <span className="text-muted-foreground text-xs">
                                                        {[dispute.holdShipper && tDispute("hold-shipper"), dispute.holdCarrier && tDispute("hold-carrier")].filter(Boolean).join(" · ")}
                                                    </span>
                                                )}
                                            </span>
                                        )
                                    })()
                                ) : (
                                    <span className="font-medium">{t(`kinds.${entry.kind}`)}</span>
                                )}
                            </div>

                            {offerLine && <p className="text-sm text-muted-foreground">{offerLine}</p>}

                            {note && <p className="text-sm text-muted-foreground">{note}</p>}

                            {entry.kind === "dispute" && typeof entry.metadata.resolution === "string" && (
                                <p className="text-sm text-muted-foreground">{entry.metadata.resolution}</p>
                            )}

                            {paymentSummary && <p className="text-sm text-muted-foreground">{paymentSummary}</p>}

                            {payment && payment.replacedManual !== null && (
                                <p className="text-sm text-muted-foreground">
                                    {t("replacedManual", {
                                        amount: f.number(payment.replacedManual, { maximumFractionDigits: 2 }),
                                        currency: payment.currency ?? "",
                                    })}
                                </p>
                            )}

                            {entry.kind === "update" && fields.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => toggle(entry.id)}
                                    className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                >
                                    <IconChevronDown className={cn("size-3.5 transition-transform", isOpen && "rotate-180")} />
                                    {t("changedFields", { count: fields.length })}
                                </button>
                            )}

                            {isOpen && fields.length > 0 && (
                                <dl className="mt-1 flex flex-col gap-1 rounded-lg border bg-muted/30 p-2 text-xs">
                                    {fields.map(([field, change]) => (
                                        <div key={field} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                                            <dt className="font-medium">{field}</dt>
                                            <dd className="min-w-0 truncate text-muted-foreground">
                                                {display(change.from)} → {display(change.to)}
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                            )}

                            <p className="text-xs text-muted-foreground/70">
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
