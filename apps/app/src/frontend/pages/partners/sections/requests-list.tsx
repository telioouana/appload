"use client"

import { IconCheck, IconInbox, IconLinkOff, IconX } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty"

import { Scroller } from "@workspace/ui/customs/list/scroller"
import { IdentityCell, initials } from "@workspace/ui/customs/list/table-cells"
import { KycBadge, RelationChip } from "@/frontend/pages/partners/sections/badges"
import { usePartnerMutations } from "@/frontend/pages/partners/hooks/use-partner-mutations"
import type { OrgType, PartnerRow } from "@/frontend/pages/partners/types"

/**
 * The requests list: what is waiting on an answer, split by who has to give
 * it. Incoming rows carry the two buttons that decide them; outgoing rows
 * carry the only thing their sender can still do.
 *
 * Not a table — a request is read, not scanned: the note the other company
 * attached is the point, and it needs the width.
 */
export function RequestsList({
    items,
    orgType,
    onOpen,
}: {
    items: PartnerRow[]
    orgType: OrgType
    onOpen: (row: PartnerRow) => void
}) {
    const t = useTranslations("App.partners.requests")

    const incoming = items.filter((row) => row.direction === "incoming")
    const outgoing = items.filter((row) => row.direction === "outgoing")

    if (items.length === 0) {
        return (
            <Scroller>
                <Empty className="border-none py-16">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <IconInbox stroke={1.5} />
                        </EmptyMedia>
                        <EmptyTitle>{t("empty.title")}</EmptyTitle>
                        <EmptyDescription>{t("empty.description")}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            </Scroller>
        )
    }

    return (
        <Scroller>
            <div className="flex flex-col gap-6 p-4">
                {incoming.length > 0 && (
                    <Section title={t("incoming")} rows={incoming} orgType={orgType} onOpen={onOpen} />
                )}
                {outgoing.length > 0 && (
                    <Section title={t("outgoing")} rows={outgoing} orgType={orgType} onOpen={onOpen} />
                )}
            </div>
        </Scroller>
    )
}

function Section({
    title,
    rows,
    orgType,
    onOpen,
}: {
    title: string
    rows: PartnerRow[]
    orgType: OrgType
    onOpen: (row: PartnerRow) => void
}) {
    return (
        <section className="flex flex-col gap-2">
            <h2 className="text-muted-foreground px-1 text-xs font-medium tracking-wide uppercase">{title}</h2>

            <div className="flex flex-col gap-2">
                {rows.map((row) => <RequestCard key={row.id} row={row} orgType={orgType} onOpen={onOpen} />)}
            </div>
        </section>
    )
}

function RequestCard({
    row,
    orgType,
    onOpen,
}: {
    row: PartnerRow
    orgType: OrgType
    onOpen: (row: PartnerRow) => void
}) {
    const t = useTranslations("App.partners")
    const f = useFormatter()
    const { respond, withdraw } = usePartnerMutations()

    const isWorking = respond.isPending || withdraw.isPending

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={(event) => {
                if (event.target instanceof Element && event.target.closest("button")) return
                onOpen(row)
            }}
            onKeyDown={(event) => { if (event.key === "Enter") onOpen(row) }}
            className="ring-foreground/5 hover:ring-primary/40 focus-visible:ring-ring/50 flex cursor-pointer flex-col gap-3 rounded-2xl px-4 py-3 ring-1 transition-colors outline-none focus-visible:ring-3"
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <IdentityCell
                    fallback={initials(row.partner.name)}
                    name={row.partner.name}
                    sub={row.partner.province ?? undefined}
                />

                <div className="flex flex-wrap items-center gap-2">
                    <RelationChip relation={row.relation} orgType={orgType} />
                    <KycBadge status={row.partner.kycStatus} />
                    <span className="text-muted-foreground text-xs">
                        {f.dateTime(row.createdAt, { dateStyle: "medium" })}
                    </span>
                </div>
            </div>

            {row.message && (
                <p className="text-muted-foreground bg-muted/40 rounded-xl px-3 py-2 text-sm">{row.message}</p>
            )}

            <div className="flex flex-wrap justify-end gap-2">
                {row.direction === "incoming" ? (
                    <>
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={isWorking}
                            onClick={() => respond.mutate({ id: row.id, decision: "decline" })}
                        >
                            <IconX stroke={1.5} />
                            {t("actions.decline")}
                        </Button>
                        <Button
                            size="sm"
                            disabled={isWorking}
                            onClick={() => respond.mutate({ id: row.id, decision: "accept" })}
                        >
                            <IconCheck stroke={1.5} />
                            {t("actions.accept")}
                        </Button>
                    </>
                ) : (
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={isWorking}
                        onClick={() => withdraw.mutate({ id: row.id })}
                    >
                        <IconLinkOff stroke={1.5} />
                        {t("actions.withdraw")}
                    </Button>
                )}
            </div>
        </div>
    )
}
