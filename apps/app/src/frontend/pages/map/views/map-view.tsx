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

import { useMapSelection } from "@/frontend/pages/map/hooks/use-map-selection"
import { matchesEntity } from "@/frontend/pages/map/lib/search"
import { MapEntityList } from "@/frontend/pages/map/sections/map-entity-list"
import { MapSelectedCard } from "@/frontend/pages/map/sections/map-selected-card"
import { OverviewPins } from "@/frontend/pages/map/sections/overview-pins"
import { OVERVIEW_POLL_MS, TRAIL_POLL_MS, type LatLng, type MapEntity, type TrailPoint } from "@/frontend/pages/map/types"

/**
 * The open movement's road route drawn over its trail of pings. The route is
 * its own query — selecting a pin costs one lookup, cached for five minutes
 * because the road does not move, and never retried, because an address
 * Google could not resolve will not resolve on a second ask. The trail is
 * fetched by the view above, so the overview knows whether this layer has a
 * pin to draw yet.
 *
 * An order and a trip cache their routes in their own tables, so which of the
 * two queries runs is decided here rather than by the caller; the disabled
 * one costs nothing.
 */
function SelectedRoute({ entity, trail, emphasis }: { entity: MapEntity; trail: TrailPoint[]; emphasis: "normal" | "match" | "dim" }) {
    const trpc = useTRPC()

    const isOrder = entity.kind === "order"

    const orderRoute = useQuery(trpc.map.orderRoute.queryOptions(
        { orderId: entity.ref },
        { enabled: isOrder, staleTime: 5 * 60_000, retry: false },
    ))

    const tripRoute = useQuery(trpc.trips.route.queryOptions(
        { id: entity.id },
        { enabled: !isOrder, staleTime: 5 * 60_000, retry: false },
    ))

    return (
        <RouteLayer
            route={isOrder ? orderRoute.data : tripRoute.data}
            trail={trail}
            status={entity.status}
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
    const t = useTranslations("App.map")
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
 * Everything of this company's that is on the road, on one map: its Appload
 * orders in transit and the trips it tracks itself. The list on the left
 * names them, the pins place them, and opening one draws its planned route
 * against the ground it has actually covered. The whole view is
 * viewport-locked — the page never scrolls, the list does.
 */
export function MapView() {
    const t = useTranslations("App.map")
    const trpc = useTRPC()

    const { selected, query, select, setQuery } = useMapSelection()

    // Under `md` the list is an overlay over the map; there is no room for both
    const [isListOpen, setListOpen] = useState(false)

    const { data: entities } = useSuspenseQuery(
        trpc.map.overview.queryOptions(undefined, { refetchInterval: OVERVIEW_POLL_MS }),
    )

    const matches = useMemo(
        () => new Set(entities.filter((entity) => matchesEntity(entity, query)).map((entity) => entity.ref)),
        [entities, query],
    )

    const selectedEntity = useMemo(
        () => entities.find((entity) => entity.ref === selected) ?? null,
        [entities, selected],
    )

    const isOrder = selectedEntity?.kind === "order"

    // The open movement's pings live here rather than inside SelectedRoute so
    // the overview can hold its pin until the route layer has one of its own:
    // dropping it the moment a pin is clicked leaves that truck unmarked for
    // a whole round trip, and for good if the trail request fails. An order's
    // trail and a trip's are two tables and two procedures; only the one
    // matching the open pin runs.
    const orderTrail = useQuery(trpc.map.orderTrail.queryOptions(
        { orderId: selectedEntity?.ref ?? "" },
        { enabled: Boolean(selectedEntity) && isOrder, refetchInterval: TRAIL_POLL_MS },
    ))

    const tripTrail = useQuery(trpc.trips.trail.queryOptions(
        { id: selectedEntity?.id ?? "" },
        { enabled: Boolean(selectedEntity) && !isOrder, refetchInterval: TRAIL_POLL_MS },
    ))

    const trail = useMemo<TrailPoint[]>(
        () => (selectedEntity && (isOrder ? orderTrail.data : tripTrail.data)) || [],
        [selectedEntity, isOrder, orderTrail.data, tripTrail.data],
    )

    const points = useMemo<LatLng[]>(
        () => entities.flatMap((entity) => entity.lastPosition
            ? [{ lat: entity.lastPosition.lat, lng: entity.lastPosition.lng }]
            : []),
        [entities],
    )

    const onSelect = (ref: string) => {
        select(ref === selected ? null : ref)
        setListOpen(false)
    }

    return (
        <>
            <header className="flex flex-col gap-1 px-2">
                <div className="flex items-center gap-2.5">
                    <h1 className="font-heading truncate text-2xl font-semibold tracking-tight">{t("title")}</h1>
                    <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums">
                        {entities.length.toLocaleString()}
                    </span>
                </div>
                <p className="text-muted-foreground text-sm">{t("description")}</p>
            </header>

            <div className="bg-card relative flex min-h-0 flex-1 overflow-hidden rounded-3xl border">
                <MapEntityList
                    entities={entities}
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
                    {entities.length === 0 ? (
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
                                    entities={entities}
                                    matches={matches}
                                    query={query}
                                    selected={selected}
                                    hasTrail={trail.length > 0}
                                    onSelect={onSelect}
                                />

                                {selectedEntity && (
                                    <SelectedRoute
                                        entity={selectedEntity}
                                        trail={trail}
                                        emphasis={!query ? "normal" : matches.has(selectedEntity.ref) ? "match" : "dim"}
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

                    {selectedEntity && (
                        <MapSelectedCard
                            key={selectedEntity.ref}
                            entity={selectedEntity}
                            onClose={() => select(null)}
                            className="absolute top-3 right-3 z-20 max-w-sm"
                        />
                    )}
                </section>

                {/* The open list covers its own toggle on a phone, so the map
                    beside it becomes the way out — without this the overlay
                    can only be dismissed by picking a movement. */}
                {isListOpen && (
                    <button
                        type="button"
                        aria-label={t("selected.close")}
                        className="absolute inset-0 z-20 md:hidden"
                        onClick={() => setListOpen(false)}
                    />
                )}
            </div>
        </>
    )
}
