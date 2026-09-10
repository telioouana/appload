"use client"

import type { OrderStatus } from "@workspace/db/types"
import { useFormatter, useTranslations } from "@workspace/i18n"
import { MapCanvas } from "@workspace/maps/components/map-canvas"
import { GoogleMapsProvider, mapsConfigured } from "@workspace/maps/components/maps-provider"
import { RouteLayer } from "@workspace/maps/components/route-layer"
import { useRouteColors } from "@workspace/maps/lib/colors"
import type { OrderRouteDto, TrailPoint } from "@workspace/maps/types"
import { cn } from "@workspace/ui/lib/utils"

type Props = {
    route: OrderRouteDto | null | undefined
    trail: TrailPoint[]
    /** The route lookup came back empty-handed; the pings are all there is */
    routeFailed: boolean
    status: OrderStatus
    className?: string
}

/**
 * One movement on a map: its route, its pings, and a line of chips saying what
 * you are looking at. Deliberately query-free — an order's route and a trip's
 * live in separate tables behind separate procedures, but the picture they
 * draw is the same picture, and captioning it in two places is how the same
 * legend ends up saying two different things.
 *
 * No waiting on the route: it is the slow, failure-prone half (a cold compute
 * is a Routes call plus two geocodes, up to 8s each) and the map draws without
 * it — RouteLayer takes `undefined` and puts the pings on screen alone.
 */
export function RouteMap({ route, trail, routeFailed, status, className }: Props) {
    const t = useTranslations("App.map.detail")
    const f = useFormatter()
    const colors = useRouteColors()

    const last = trail.at(-1)

    return (
        <div className={cn("relative", className)}>
            <GoogleMapsProvider missingKeyMessage={t("missing-key")}>
                <MapCanvas>
                    <RouteLayer route={route} trail={trail} status={status} fit />
                </MapCanvas>
            </GoogleMapsProvider>

            {mapsConfigured() ? (
                <>
                    <div className="bg-popover/90 text-popover-foreground pointer-events-none absolute top-2 left-2 flex flex-col gap-1 rounded-md border px-2 py-1 text-[11px] shadow-sm backdrop-blur">
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
                        {routeFailed ? <Chip>{t("unavailable")}</Chip> : null}
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
        <span className="bg-popover/90 text-popover-foreground rounded-md border px-2 py-1 text-[11px] shadow-sm backdrop-blur">
            {children}
        </span>
    )
}
