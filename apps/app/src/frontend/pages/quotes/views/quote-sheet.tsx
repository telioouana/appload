"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { IconArrowNarrowRight, IconCheck, IconExternalLink, IconLoader2, IconMailOff, IconX } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Separator } from "@workspace/ui/components/separator"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"

import type { TrackingAllowance } from "@workspace/domain/subscription"

import { Link } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { initials } from "@/components/list/table-cells"
import { EmptyValue } from "@/components/list/empty-value"
import { PlanDialog, planBlock, type PlanReason } from "@/components/plan-dialog"
import { CoverChips, QuoteStatusChip, useMoney } from "@/frontend/pages/quotes/sections/badges"
import { AcceptQuoteDialog } from "@/frontend/pages/quotes/sections/accept-quote-dialog"
import { DeclineQuoteDialog } from "@/frontend/pages/quotes/sections/decline-quote-dialog"
import { useQuoteMutations } from "@/frontend/pages/quotes/hooks/use-quote-mutations"
import { useQuoteSheet } from "@/frontend/pages/quotes/hooks/use-quote-sheet"
import type { OrgType, QuoteDetail } from "@/frontend/pages/quotes/types"

/**
 * The quote panel the page mounts once. Which quote it shows comes from the
 * URL, so a row click and a shared link open the same thing.
 *
 * What it offers comes from the server's own `permissions`, not from a rule
 * restated here: the buttons can only ever be the moves the mutations accept.
 */
export function QuoteSheet({
    orgType,
    allowance,
    organizationName,
}: {
    orgType: OrgType
    allowance: TrackingAllowance
    organizationName: string
}) {
    const t = useTranslations("App.quotes.panel")
    const { id, close } = useQuoteSheet()

    return (
        <Sheet open={Boolean(id)} onOpenChange={(next) => { if (!next) close() }}>
            <SheetContent
                side="right"
                className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none md:data-[side=right]:w-[560px]"
            >
                <SheetHeader className="sr-only">
                    <SheetTitle>{t("title")}</SheetTitle>
                    <SheetDescription>{t("description")}</SheetDescription>
                </SheetHeader>

                {id && (
                    <Panel
                        key={id}
                        id={id}
                        orgType={orgType}
                        allowance={allowance}
                        organizationName={organizationName}
                        onClose={close}
                    />
                )}
            </SheetContent>
        </Sheet>
    )
}

function Panel({
    id,
    orgType,
    allowance,
    organizationName,
    onClose,
}: {
    id: string
    orgType: OrgType
    allowance: TrackingAllowance
    organizationName: string
    onClose: () => void
}) {
    const t = useTranslations("App.quotes")
    const trpc = useTRPC()

    const { data, isPending, isError } = useQuery(trpc.quotes.get.queryOptions({ id }))

    if (isPending) {
        return (
            <div className="flex flex-col gap-4 p-6">
                <Skeleton className="h-12 w-12 rounded-full" />
                <Skeleton className="h-6 w-48 rounded-md" />
                <Skeleton className="h-4 w-64 rounded-md" />
                <Skeleton className="h-40 w-full rounded-2xl" />
            </div>
        )
    }

    if (isError || !data) {
        return <p className="text-destructive p-6 text-sm">{t("panel.error")}</p>
    }

    return (
        <Loaded
            quote={data}
            orgType={orgType}
            allowance={allowance}
            organizationName={organizationName}
            onClose={onClose}
        />
    )
}

function Loaded({
    quote,
    orgType,
    allowance,
    organizationName,
    onClose,
}: {
    quote: QuoteDetail
    orgType: OrgType
    allowance: TrackingAllowance
    organizationName: string
    onClose: () => void
}) {
    const t = useTranslations("App.quotes")
    const f = useFormatter()
    const money = useMoney()

    const { withdraw } = useQuoteMutations()
    const [declining, setDeclining] = useState(false)
    const [accepting, setAccepting] = useState(false)
    const [planReason, setPlanReason] = useState<PlanReason | null>(null)

    const { partner, money: price, permissions } = quote

    // Accepting a standing quote books an order, which is what a plan pays
    // for — so the button stays and says why rather than disappearing
    const blocked = planBlock(allowance)

    const capacity = quote.capacityWeight !== null && quote.capacityUnit !== null
        ? `${f.number(quote.capacityWeight, { maximumFractionDigits: 2 })} ${t(`unit.${quote.capacityUnit}`)}`
        : null

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-col gap-3 px-6 pt-6 pb-4">
                <div className="flex items-center gap-3">
                    <Avatar className="size-12">
                        <AvatarFallback className="text-sm font-medium">{initials(partner.name)}</AvatarFallback>
                    </Avatar>

                    <div className="flex min-w-0 flex-col gap-0.5">
                        <h2 className="font-heading truncate text-xl font-semibold tracking-tight">{partner.name}</h2>
                        <span className="text-muted-foreground truncate text-sm">
                            {t(`panel.role.${orgType}`)}
                            {partner.province ? ` · ${partner.province}` : ""}
                        </span>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <QuoteStatusChip status={quote.status} />
                    <CoverChips includesGit={quote.includesGit} includesGps={quote.includesGps} />
                </div>
            </div>

            <Separator />

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <div className="flex flex-col gap-6">
                    <section className="flex flex-col gap-2">
                        <SectionTitle>{t("panel.lane")}</SectionTitle>

                        <div className="flex flex-col gap-1.5 text-sm">
                            <span>{quote.origin.address}</span>
                            <span className="text-muted-foreground flex items-center gap-1.5">
                                <IconArrowNarrowRight className="size-4 shrink-0" stroke={1.5} />
                                {quote.destination.address}
                            </span>
                        </div>

                        <dl className="mt-2 flex flex-col gap-2">
                            <Line label={t("panel.fields.route")} value={t(`route.${quote.route}`)} />
                            <Line
                                label={t("panel.fields.loading")}
                                value={quote.loadingDate ? f.dateTime(quote.loadingDate, { dateStyle: "long" }) : null}
                                empty={t("values.open-date")}
                            />
                            <Line
                                label={t("panel.fields.valid")}
                                value={quote.validUntil ? f.dateTime(quote.validUntil, { dateStyle: "long" }) : null}
                                empty={t("values.no-expiry")}
                            />
                        </dl>
                    </section>

                    <section className="flex flex-col gap-2">
                        <SectionTitle>{t("panel.capacity")}</SectionTitle>

                        <dl className="flex flex-col gap-2">
                            <Line
                                label={t("panel.fields.bay")}
                                value={quote.loadingBay ? t(`bay.${quote.loadingBay}`) : null}
                                empty={t("values.not-stated")}
                            />
                            <Line
                                label={t("panel.fields.capacity")}
                                value={capacity}
                                empty={t("values.not-stated")}
                            />
                        </dl>
                    </section>

                    <section className="flex flex-col gap-2">
                        <SectionTitle>{t("panel.price")}</SectionTitle>

                        <dl className="flex flex-col gap-2">
                            <Line
                                label={t("panel.fields.subtotal")}
                                value={price.subtotal === null ? null : money(price.subtotal, price.currency)}
                                empty={t("values.not-stated")}
                            />
                            <Line
                                label={t("panel.fields.vat")}
                                value={price.vat === null ? null : money(price.vat, price.currency)}
                                empty={t("values.not-stated")}
                            />
                            <Line
                                label={t("panel.fields.total")}
                                value={money(price.total, price.currency)}
                                strong
                            />
                            <Line label={t("panel.fields.regime")} value={t(`regime.${quote.fiscalRegime}`)} />
                        </dl>

                        <p className="text-muted-foreground text-xs">{t("panel.price-note")}</p>
                    </section>

                    {quote.notes && (
                        <section className="flex flex-col gap-2">
                            <SectionTitle>{t("panel.notes")}</SectionTitle>
                            <p className="text-sm whitespace-pre-wrap">{quote.notes}</p>
                        </section>
                    )}

                    <section className="flex flex-col gap-2">
                        <SectionTitle>{t("panel.history")}</SectionTitle>

                        <dl className="flex flex-col gap-2">
                            <Line
                                label={t("panel.fields.sent")}
                                value={f.dateTime(quote.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                            />
                            <Line
                                label={t("panel.fields.decided")}
                                value={quote.decidedAt ? f.dateTime(quote.decidedAt, { dateStyle: "medium", timeStyle: "short" }) : null}
                                empty={t("values.pending")}
                            />
                        </dl>

                        {quote.orderRef && (
                            <Button asChild variant="outline" size="sm" className="mt-1 w-fit">
                                <Link href={{ pathname: "/orders/details/[orderId]", params: { orderId: quote.orderRef } }}>
                                    <IconExternalLink className="size-4" stroke={1.5} />
                                    {t("panel.open-order", { orderId: quote.orderRef })}
                                </Link>
                            </Button>
                        )}
                    </section>
                </div>
            </div>

            {(permissions.canWithdraw || permissions.canDecline || permissions.canAccept) && (
                <>
                    <Separator />

                    <div className="flex flex-wrap items-center gap-2 px-6 py-4">
                        {permissions.canWithdraw && (
                            <Button
                                variant="outline"
                                disabled={withdraw.isPending}
                                onClick={() => withdraw.mutate({ id: quote.id }, { onSuccess: onClose })}
                            >
                                {withdraw.isPending
                                    ? <IconLoader2 className="size-4 animate-spin" stroke={1.5} />
                                    : <IconMailOff className="size-4" stroke={1.5} />}
                                {t("actions.withdraw")}
                            </Button>
                        )}

                        {permissions.canAccept && (
                            <Button onClick={() => (blocked ? setPlanReason(blocked) : setAccepting(true))}>
                                <IconCheck className="size-4" stroke={1.5} />
                                {t("actions.accept")}
                            </Button>
                        )}

                        {permissions.canDecline && (
                            <Button variant="outline" onClick={() => setDeclining(true)}>
                                <IconX className="size-4" stroke={1.5} />
                                {t("actions.decline")}
                            </Button>
                        )}
                    </div>
                </>
            )}

            <DeclineQuoteDialog
                quoteId={quote.id}
                open={declining}
                onOpenChange={setDeclining}
                onDeclined={onClose}
            />

            <AcceptQuoteDialog
                quote={quote}
                open={accepting}
                onOpenChange={setAccepting}
                onAccepted={onClose}
                onPlanRequired={(reason) => { setAccepting(false); setPlanReason(reason) }}
            />

            {planReason && (
                <PlanDialog
                    reason={planReason}
                    allowance={allowance}
                    organizationName={organizationName}
                    onClose={() => setPlanReason(null)}
                />
            )}
        </div>
    )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{children}</h3>
}

/** One label/value line; a missing value says so rather than leaving a blank. */
function Line({
    label,
    value,
    empty,
    strong,
}: {
    label: string
    value: string | null
    empty?: string
    strong?: boolean
}) {
    return (
        <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground shrink-0 text-[13px]">{label}</dt>
            <dd className={strong ? "text-right text-sm font-semibold tabular-nums" : "text-right text-sm"}>
                {value ?? <EmptyValue label={empty ?? "—"} />}
            </dd>
        </div>
    )
}
