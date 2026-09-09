"use client"

import { useMemo, useState } from "react"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { useMap } from "@vis.gl/react-google-maps"
import { IconList, IconMapPin, IconMaximize } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { MapCanvas } from "@workspace/maps/components/map-canvas"
import { GoogleMapsProvider } from "@workspace/maps/components/maps-provider"
import { RouteLayer } from "@workspace/maps/components/route-layer"
import { fitMapTo } from "@workspace/maps/lib/use-fit-bounds"

import { Button } from "@workspace/ui/components/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { OrderSheet } from "@/frontend/pages/orders/views/order-sheet"

import { useMapSelection } from "@/frontend/pages/map/hooks/use-map-selection"
import { matchesOrder } from "@/frontend/pages/map/lib/search"
import { MapOrderList } from "@/frontend/pages/map/sections/map-order-list"
import { MapSelectedCard } from "@/frontend/pages/map/sections/map-selected-card"
import { OverviewPins } from "@/frontend/pages/map/sections/overview-pins"
import { OVERVIEW_POLL_MS, TRAIL_POLL_MS, type LatLng, type MapOrder, type TrailPoint } from "@/frontend/pages/map/types"

/**
 * The open load's road route drawn over its trail of pings. The route is its
 * own query — selecting a pin costs one lookup, cached for five minutes
 * because the road does not move. The trail is fetched by the view above, so
 * the overview knows whether this layer has a pin to draw yet.
 */
function SelectedRoute({ order, trail, emphasis }: { order: MapOrder; trail: TrailPoint[]; emphasis: "normal" | "match" | "dim" }) {
    const trpc = useTRPC()

    const route = useQuery(trpc.map.route.queryOptions({ orderId: order.orderId }, { staleTime: 5 * 60_000, retry: false }))

    return (
        <RouteLayer
            route={route.data}
            trail={trail}
            status={order.status}
            fit
            selected
            emphasis={emphasis}
        />
    )
}

/**
 * Back to the whole fleet. Sits outside the map element but inside the
 * provider, where `useMap()` still resolves the default instance — the map's
 * own children are overlays the Maps API positions, not page furniture.
 */
function ShowAllControl({ points, onShowAll }: { points: LatLng[]; onShowAll: () => void }) {
    const t = useTranslations("Admin.map")
    const map = useMap()

    if (points.length === 0) return null

    return (
        <Button
            size="sm"
            variant="secondary"
            className="absolute right-3 bottom-3 z-10 shadow-lg"
            onClick={() => {
                onShowAll()
                if (map) fitMapTo(map, points)
            }}
        >
            <IconMaximize className="size-4" stroke={1.5} />
            {t("show-all")}
        </Button>
    )
}

/**
 * Every on-going load on one map: the list on the left names them, the pins
 * place them, and opening one draws its planned route against the ground it
 * has actually covered. The whole view is viewport-locked — the page never
 * scrolls, the list does.
 */
export function MapView() {
    const t = useTranslations("Admin.map")
    const trpc = useTRPC()

    const { selected, query, select, setQuery } = useMapSelection()

    // Under `md` the list is an overlay over the map; there is no room for both
    const [isListOpen, setListOpen] = useState(false)

    const { data: orders } = useSuspenseQuery(
        trpc.map.overview.queryOptions(undefined, { refetchInterval: OVERVIEW_POLL_MS }),
    )

    const matches = useMemo(
        () => new Set(orders.filter((order) => matchesOrder(order, query)).map((order) => order.orderId)),
        [orders, query],
    )

    const selectedOrder = useMemo(
        () => orders.find((order) => order.orderId === selected) ?? null,
        [orders, selected],
    )

    // The open load's pings live here rather than inside SelectedRoute so the
    // overview can hold its pin until the route layer has one of its own:
    // dropping it the moment a pin is clicked leaves that truck unmarked for
    // a whole round trip, and for good if the trail request fails.
    const trailQuery = useQuery(trpc.map.trail.queryOptions(
        { orderId: selectedOrder?.orderId ?? "" },
        { enabled: Boolean(selectedOrder), refetchInterval: TRAIL_POLL_MS },
    ))

    const trail = useMemo<TrailPoint[]>(
        () => (selectedOrder && trailQuery.data) || [],
        [selectedOrder, trailQuery.data],
    )

    const points = useMemo<LatLng[]>(
        () => orders.flatMap((order) => order.lastLocation
            ? [{ lat: order.lastLocation.lat, lng: order.lastLocation.lng }]
            : []),
        [orders],
    )

    const onSelect = (orderId: string) => {
        select(orderId === selected ? null : orderId)
        setListOpen(false)
    }

    return (
        <>
            <header className="flex flex-col gap-1 px-2">
                <div className="flex items-center gap-2.5">
                    <h1 className="font-heading truncate text-2xl font-semibold tracking-tight">{t("title")}</h1>
                    <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums">
                        {orders.length.toLocaleString()}
                    </span>
                </div>
                <p className="text-muted-foreground text-sm">{t("description")}</p>
            </header>

            <div className="bg-card relative flex min-h-0 flex-1 overflow-hidden rounded-3xl border">
                <MapOrderList
                    orders={orders}
                    matches={matches}
                    query={query}
                    onQueryChange={setQuery}
                    selected={selected}
                    onSelect={onSelect}
                    className={cn(
                        isListOpen
                            ? "absolute inset-y-0 left-0 z-30 shadow-xl md:static md:shadow-none"
                            : "hidden md:flex",
                    )}
                />

                <section className="relative min-w-0 flex-1">
                    {orders.length === 0 ? (
                        <Empty className="h-full">
                            <EmptyHeader>
                                <EmptyMedia variant="icon">
                                    <IconMapPin />
                                </EmptyMedia>
                                <EmptyTitle>{t("empty.title")}</EmptyTitle>
                                <EmptyDescription>{t("empty.description")}</EmptyDescription>
                            </EmptyHeader>
                        </Empty>
                    ) : (
                        <GoogleMapsProvider missingKeyMessage={t("detail.missing-key")}>
                            {/* The map owns the whole viewport here, so the
                                wheel zooms it instead of scrolling a page */}
                            <MapCanvas className="h-full w-full" gestureHandling="greedy">
                                <OverviewPins
                                    orders={orders}
                                    matches={matches}
                                    query={query}
                                    selected={selected}
                                    hasTrail={trail.length > 0}
                                    onSelect={onSelect}
                                />

                                {selectedOrder && (
                                    <SelectedRoute
                                        order={selectedOrder}
                                        trail={trail}
                                        emphasis={!query ? "normal" : matches.has(selectedOrder.orderId) ? "match" : "dim"}
                                    />
                                )}
                            </MapCanvas>

                            <ShowAllControl points={points} onShowAll={() => select(null)} />
                        </GoogleMapsProvider>
                    )}

                    <Button
                        size="sm"
                        variant="secondary"
                        className="absolute top-3 left-3 z-10 shadow-lg md:hidden"
                        onClick={() => setListOpen((open) => !open)}
                    >
                        <IconList className="size-4" stroke={1.5} />
                        {t("list.toggle")}
                    </Button>

                    {selectedOrder && (
                        <MapSelectedCard
                            key={selectedOrder.orderId}
                            order={selectedOrder}
                            onClose={() => select(null)}
                            className="absolute top-3 right-3 z-20 max-w-sm"
                        />
                    )}
                </section>

                {/* The open list covers its own toggle on a phone, so the map
                    beside it becomes the way out — without this the overlay
                    can only be dismissed by picking a load. */}
                {isListOpen && (
                    <button
                        type="button"
                        aria-label={t("selected.close")}
                        className="absolute inset-0 z-20 md:hidden"
                        onClick={() => setListOpen(false)}
                    />
                )}
            </div>

            {/* URL-driven by `?id=`: the card's "Open order" writes it */}
            <OrderSheet />
        </>
    )
}
