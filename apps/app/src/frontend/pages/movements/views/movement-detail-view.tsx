"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { ApploadOrderPanels } from "@/frontend/pages/movements/sections/appload-panels"
import { CostsCard } from "@/frontend/pages/movements/sections/costs-card"
import { DisputeBanner } from "@/frontend/pages/movements/sections/dispute-banner"
import { DocumentsCard } from "@/frontend/pages/movements/sections/documents-card"
import { LoadHeader } from "@/frontend/pages/movements/sections/load-header"
import { MoneyCard } from "@/frontend/pages/movements/sections/money-card"
import { PartiesCard } from "@/frontend/pages/movements/sections/parties-card"
import { RouteCard } from "@/frontend/pages/movements/sections/route-card"
import { TimelineCard } from "@/frontend/pages/movements/sections/timeline-card"
import { TrackingCard } from "@/frontend/pages/movements/sections/tracking-card"

/**
 * One load on one page: a dispute on it first, then where it goes and what
 * it carries, who is on it, what it is worth to the reader, what it cost to
 * run, the papers, where the truck is and what has happened. This file owns
 * the queries and hands each block what it renders; what the reader may see
 * and do was decided by the server, role by role.
 *
 * A load that follows an Appload order keeps its own lane, its own money and
 * its own books here, and everything the two companies do about it — the
 * offers, the moves on, the rig, the papers — is the order's, read through
 * `ApploadOrderPanels`. What the parties say to each other is on the Chats
 * page, which the header's Open chat menu links to. A company Appload is
 * still asking has only a quote to give, so its row shows the lane and the
 * form.
 */
export function MovementDetailView({ loadId }: { loadId: string }) {
    const t = useTranslations("App.loads.detail")
    const f = useFormatter()
    const trpc = useTRPC()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const { data: load } = useSuspenseQuery(trpc.movements.get.queryOptions({ id: loadId }))

    const owner = load.role === "owner"
    // A shipper's own trucks earn it nothing, so a load with no price on it
    // has no money to show; its running costs are the card below
    const hasMoney = Boolean(load.money.payable || load.money.receivable)
        || (owner && session.organization.type === "carrier")

    const appload = load.appload
    // Appload is still asking this company for a price: there is no load to
    // run yet, and nothing on the page but the lane and the quote
    const candidate = appload?.role === "candidate"

    return (
        <>
            <LoadHeader
                load={load}
                orgType={session.organization.type}
                allowance={session.allowance}
                organizationName={session.organization.name}
                actions={!candidate}
            />

            {load.dispute && <DisputeBanner dispute={load.dispute} />}

            {/* From lg up the page itself does not scroll: the left column
                does, so the tracking on the right stays where it was. Below
                lg it is one column and the page scrolls instead. */}
            <div className="grid gap-4 px-2 pb-2 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,26rem)]">
                <div className="container-snap flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pb-2">
                    <RouteCard load={load} />

                    {!candidate && <PartiesCard load={load} orgType={session.organization.type} />}

                    {/* Everything the order decides, in the order's own blocks */}
                    {appload && <ApploadOrderPanels orderId={appload.orderId} side={appload.role} column="left" />}

                    {!candidate && hasMoney && <MoneyCard load={load} />}

                    {/* What the load cost to run is the owner's alone */}
                    {!candidate && owner && <CostsCard load={load} />}

                    {!candidate && <DocumentsCard load={load} />}

                    <p className="text-muted-foreground px-1 text-xs">
                        {t("footer", {
                            created: f.dateTime(load.createdAt, { dateStyle: "medium" }),
                            updated: f.dateTime(load.updatedAt, { dateStyle: "medium", timeStyle: "short" }),
                        })}
                    </p>
                </div>

                {!candidate && (
                    <div className="container-snap flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pb-2">
                        {appload ? (
                            // Where the truck is, what the parties are saying
                            // and what has happened are all the order's: the
                            // row is only this company's copy of it
                            <ApploadOrderPanels orderId={appload.orderId} side={appload.role} column="right" />
                        ) : (
                            <TrackingCard load={load} />
                        )}

                        <TimelineCard load={load} />
                    </div>
                )}
            </div>
        </>
    )
}
