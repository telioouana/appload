"use client"

import { useQuery } from "@tanstack/react-query"
import { IconMapPinShare } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { TRAIL_POLL_MS } from "@workspace/maps/types"
import { SectionCard } from "@workspace/ui/customs/detail/section-card"
import { EmptyValue } from "@workspace/ui/customs/list/empty-value"

import { useTRPC } from "@/backend/api/client"
import { LastPingCell } from "@/frontend/pages/movements/components/badges"
import { useMovementMutations } from "@/frontend/pages/movements/hooks/use-movement-mutations"
import type { MovementDetail } from "@/frontend/pages/movements/types"

/**
 * Where the truck has reported from. A load handed to a partner on the
 * portal is tracked by that partner — its driver is asked once, by the
 * company that employs them — and the positions show here as they arrive.
 */
export function TrackingCard({ load }: { load: MovementDetail }) {
    const t = useTranslations("App.loads.tracking")
    const f = useFormatter()
    const trpc = useTRPC()

    const { requestLocation } = useMovementMutations()

    // The same polling query the map draws from, so the list and the line
    // can never show a different last position
    const { data: points = [] } = useQuery(
        trpc.movements.trail.queryOptions({ id: load.id }, { refetchInterval: TRAIL_POLL_MS }),
    )

    return (
        <SectionCard
            title={t("title")}
            count={points.length}
            actions={load.permissions.canRequestLocation ? (
                <Button
                    size="sm"
                    variant="outline"
                    disabled={requestLocation.isPending}
                    onClick={() => requestLocation.mutate({ id: load.id })}
                >
                    {requestLocation.isPending ? <Spinner className="size-4" /> : <IconMapPinShare className="size-4" stroke={1.5} />}
                    {t("request")}
                </Button>
            ) : undefined}
        >
            <div className="bg-muted/40 flex items-center justify-between gap-4 rounded-xl px-4 py-3">
                <span className="text-muted-foreground text-[13px]">{t("last")}</span>
                <LastPingCell ping={load.lastPing} />
            </div>

            {load.isLinked && <p className="text-muted-foreground text-xs">{t("linked")}</p>}
            {!load.trackingEnabled && <p className="text-muted-foreground text-xs">{t("disabled")}</p>}

            {points.length === 0 ? (
                <EmptyValue label={t("empty")} />
            ) : (
                <ol className="flex flex-col gap-2">
                    {[...points].reverse().map((point) => (
                        <li key={point.id} className="flex items-baseline justify-between gap-4 text-[13px]">
                            <span className="min-w-0 truncate">{point.placeName ?? t("unnamed")}</span>
                            <span className="text-muted-foreground shrink-0 tabular-nums">
                                {f.dateTime(point.recordedAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </span>
                        </li>
                    ))}
                </ol>
            )}
        </SectionCard>
    )
}
