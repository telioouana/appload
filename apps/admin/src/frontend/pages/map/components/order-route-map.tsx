"use client"

import { useQuery } from "@tanstack/react-query"

import type { OrderStatus } from "@workspace/db/types"
import { useFormatter, useTranslations } from "@workspace/i18n"
import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"

import { useRouteColors } from "../lib/colors"
import { TRAIL_POLL_MS } from "../types"
import { MapCanvas } from "./map-canvas"
import { GoogleMapsProvider, mapsConfigured } from "./maps-provider"
import { RouteLayer } from "./route-layer"

type Props = {
    /** The human order id, e.g. `APPL275.26`. */
    orderId: string
    status: OrderStatus
    className?: string
}

/**
 * The map inside an order: its route, its pings, and a line of chips saying
 * what you are looking at.
 *
 * The two queries are deliberately different animals. A route is geometry the
 * server has already paid Google for, so it is cached hard and never retried —
 * an order without addresses we can geocode will never have one, and hammering
 * the endpoint would not change that. The trail polls, because the whole point
 * is watching a truck move.
 *
 * A missing route is not a missing map: pings alone still draw.
 */
export function OrderRouteMap({ orderId, status, className }: Props) {
    const t = useTranslations("Admin.map.detail")
    const f = useFormatter()
    const trpc = useTRPC()
    const colors = useRouteColors()

    const route = useQuery(trpc.map.route.queryOptions({ orderId }, { staleTime: 5 * 60_000, retry: false }))
    const trail = useQuery(trpc.map.trail.queryOptions({ orderId }, { refetchInterval: TRAIL_POLL_MS }))

    const points = trail.data ?? []
    const last = points.at(-1)
    const configured = mapsConfigured()

    // No waiting on the route: it is the slow, failure-prone half (a cold
    // compute is a Routes call plus two geocodes, up to 8s each) and the map
    // draws without it — RouteLayer takes `undefined` and puts the pings on
    // screen alone. A missing route is not a missing map.
    return (
        <div className={cn("relative", className)}>
            <GoogleMapsProvider>
                <MapCanvas>
                    <RouteLayer route={route.data} trail={points} status={status} fit />
                </MapCanvas>
            </GoogleMapsProvider>

            {configured ? (
                <>
                    <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-1 rounded-md border bg-popover/90 px-2 py-1 text-[11px] text-popover-foreground shadow-sm backdrop-blur">
                        <span className="flex items-center gap-1.5">
                            <span className="h-[3px] w-4 rounded-full" style={{ background: colors.route }} />
                            {t("legend-route")}
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="h-[3px] w-4 rounded-full" style={{ background: colors.covered }} />
                            {t("legend-covered")}
                        </span>
                    </div>

                    <div className="pointer-events-none absolute bottom-2 left-2 flex flex-col items-start gap-1">
                        {route.isError ? <Chip>{t("unavailable")}</Chip> : null}
                        {last ? (
                            <Chip>
                                {t("last-seen", {
                                    date: f.dateTime(last.recordedAt, {
                                        day: "2-digit",
                                        month: "short",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                    }),
                                })}
                            </Chip>
                        ) : (
                            <Chip>{t("no-pings")}</Chip>
                        )}
                    </div>
                </>
            ) : null}
        </div>
    )
}

function Chip({ children }: { children: React.ReactNode }) {
    return (
        <span className="rounded-md border bg-popover/90 px-2 py-1 text-[11px] text-popover-foreground shadow-sm backdrop-blur">
            {children}
        </span>
    )
}
