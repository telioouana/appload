"use client"

import { useQuery } from "@tanstack/react-query"
import { IconUserPlus } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"
import type { Order } from "@workspace/db/orders"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

import { Link } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { CopyButton } from "@/frontend/pages/partners/sections/profile-parts"
import { OperationsStrip } from "@/frontend/pages/orders/sections/order-item-parts"

import { SectionCard, StatTile } from "@workspace/ui/customs/detail/section-card"

/** Booking no longer asks for the rig, so this is where it is still missing. */
const AWAITING_ASSIGNMENT: Order["status"][] = ["booked"]

/**
 * Who is driving and in what, over the four figures the trip is judged on.
 * The strip keeps its own "no driver assigned" line, and the tiles stay
 * either way — an order with nothing assigned still has a distance.
 *
 * A booked order may legitimately have no driver and no truck yet, but it
 * cannot go to loading without them, so the card carries the cue to
 * assign them rather than leaving the operator to find the edit sheet.
 */
export function OperationsCard({ order, onAssign }: { order: Order; onAssign?: () => void }) {
    const t = useTranslations("Admin.orders.detailPage")
    const tActions = useTranslations("Admin.partners.actions")
    const f = useFormatter()

    const phone = order.driverPhoneNumber
    const needsAssignment = AWAITING_ASSIGNMENT.includes(order.status) && (!order.driverId || !order.truckPlate)

    return (
        <SectionCard
            title={t("sections.operations")}
            aside={order.carrierName ?? undefined}
            actions={onAssign && needsAssignment ? (
                <Button size="sm" variant="outline" onClick={onAssign}>
                    <IconUserPlus />
                    {t("operations.assign")}
                </Button>
            ) : undefined}
        >
            <OperationsStrip
                order={order}
                phoneAction={phone ? <CopyButton value={phone} label={tActions("copy-phone")} /> : undefined}
            />

            <PapersLine order={order} />

            <div className="grid grid-cols-2 gap-3 border-t pt-3.5 sm:grid-cols-4">
                <StatTile
                    value={order.distance !== null ? `${f.number(order.distance)} km` : <Dash />}
                    label={t("metrics.distance")}
                />
                <StatTile value={order.deliveries ?? <Dash />} label={t("metrics.deliveries")} />
                <StatTile value={order.daysSpendTraveling ?? <Dash />} label={t("metrics.daysTraveling")} />
                <StatTile
                    value={order.podStatus
                        ? <span className="text-base">{t(`pod.${order.podStatus}`)}</span>
                        : <Dash />}
                    label={t("metrics.podStatus")}
                />
            </div>
        </SectionCard>
    )
}

function Dash() {
    return <span className="text-muted-foreground/60">—</span>
}

/**
 * What the rig on this order has on file, one line per subject.
 *
 * The same lookup the dispatch guard runs, so the operator reads here
 * exactly why the move to loading would be refused — and reaches the review
 * sheet where the gap is closed, instead of hunting for the record.
 */
function PapersLine({ order }: { order: Order }) {
    const t = useTranslations("Admin.orders.detailPage.papers")
    const trpc = useTRPC()

    const { data: subjects } = useQuery({
        ...trpc.kyc.subjectPapers.queryOptions({
            driverId: order.driverId,
            truckPlate: order.truckPlate,
            trailerPlate: order.trailerPlate,
            linkPlate: order.linkPlate,
        }),
        enabled: Boolean(order.driverId || order.truckPlate || order.trailerPlate || order.linkPlate),
    })

    if (!subjects || subjects.length === 0) return null

    return (
        <div className="flex flex-col gap-2 border-t pt-3.5">
            <span className="text-muted-foreground text-xs">{t("title")}</span>

            {subjects.map((subject) => (
                <div key={`${subject.kind}-${subject.subjectId}`} className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px]">{subject.label}</span>

                    <span className="flex shrink-0 items-center gap-2">
                        {subject.papers === "missing" && (
                            <Link
                                href={reviewHref(subject.kind, subject.subjectId)}
                                className="text-primary text-xs underline"
                            >
                                {t("review")}
                            </Link>
                        )}
                        <Badge variant={subject.papers === "ok" ? "default" : subject.papers === "pending" ? "secondary" : "destructive"}>
                            {t(subject.papers)}
                        </Badge>
                    </span>
                </div>
            ))}
        </div>
    )
}

/** The review sheet for one subject — the same URL the command palette opens. */
function reviewHref(kind: "driver" | "truck" | "trailer" | "link", id: string) {
    if (kind === "driver") {
        return { pathname: "/carriers/drivers" as const, query: { id, tab: "documents" } }
    }

    return {
        pathname: "/carriers/fleets" as const,
        query: kind === "truck" ? { id, tab: "documents" } : { kind, id, tab: "documents" },
    }
}
