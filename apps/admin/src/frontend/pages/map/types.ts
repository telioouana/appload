import type { Location } from "@workspace/db/orders"
import type { OrderStatus } from "@workspace/db/types"

/** Shared contract between the map router, the map components and the pages that embed them. */

export type LatLng = { lat: number; lng: number }

/** routes = Google road polyline; geocode = endpoints only, the client draws a straight chord */
export type RouteSource = "routes" | "geocode"

export type OrderRouteDto = {
    orderId: string
    origin: LatLng
    destination: LatLng
    encodedPolyline: string | null
    distanceMeters: number | null
    durationSeconds: number | null
    source: RouteSource
    computedAt: Date
}

export type TrailPoint = {
    id: string
    lat: number
    lng: number
    placeName: string | null
    recordedAt: Date
    source: "whatsapp" | "manual"
}

export type MapOrder = {
    id: string
    orderId: string
    status: OrderStatus
    shipperName: string
    carrierName: string | null
    driverName: string | null
    driverPhoneNumber: string | null
    truckPlate: string | null
    loadingAddress: Location
    offloadingAddress: Location
    expectedOffloadingDate: Date | null
    lastLocation: TrailPoint | null
    pingCount: number
    /** Driver's chat thread, when one exists — enables "Request location" from the map */
    conversationId: string | null
}

export const OVERVIEW_POLL_MS = 60_000
export const TRAIL_POLL_MS = 60_000
/** A ping further than this from the road route gets a dashed spur instead of moving the covered path */
export const OFF_ROUTE_METERS = 2_000
