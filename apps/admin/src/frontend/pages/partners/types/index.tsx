import { KYC_STATUS } from "@workspace/db/types"
import type { Address, KycStatus, OwnershipStatus, RiskLevel } from "@workspace/db/types"

export type VIEW = "grid" | "list"

export type VehicleKind = "truck" | "trailer" | "link"

export const VEHICLE_KINDS: VehicleKind[] = ["truck", "trailer", "link"]

/** Whether the carrier holds a usable signed contract. */
export type ContractState = "valid" | "missing" | "expired"

export type DocProgress = { approved: number; required: number }

/** Inferred from the shipment's status — there is no live telemetry. */
export type TripSummary = {
    /** Cargo is aboard and the rig is between the two addresses */
    inTransit: boolean
    from: string | null
    to: string | null
    load: string | null
}

export type StatsBucket = {
    total: number
    pendingReview: number
    verified: number
    /** Subjects with an approved document running out within the window */
    expiring: number
}

export type OrgRow = {
    id: string
    name: string
    logo: string | null
    nuit: string
    email: string
    phoneNumber: string
    type: "shipper" | "carrier"
    kycStatus: KycStatus
    riskLevel: RiskLevel
    riskReason: string | null
    physicalAddress: Address | null
    city: string | null
    progress: DocProgress
    contract: ContractState | null
    nextExpiry: string | null
    activeOrders: number
    totalOrders: number
    /** Share of orders fully paid — not an on-time rate, see procedures.ts */
    settledRate: number | null
    onTimeRate: number | null
    fleetSize: number
}

export type DriverRow = {
    id: string
    name: string
    image: string | null
    email: string
    phoneNumber: string | null
    carrierId: string
    carrierName: string | null
    kycStatus: KycStatus
    progress: DocProgress
    nextExpiry: string | null
    trip: TripSummary | null
    plate: string | null
}

export type VehicleRow = {
    id: string
    kind: VehicleKind
    regPlate: string
    internalId: string | null
    brand: string
    model: string
    year: number
    carrierId: string
    carrierName: string | null
    kycStatus: KycStatus
    ownershipStatus: OwnershipStatus
    ownerName: string | null
    capacity: number | null
    progress: DocProgress
    nextExpiry: string | null
    trip: TripSummary | null
    driverName: string | null
}

const parseStatus = (value: string | null): KycStatus | undefined =>
    value && (KYC_STATUS as readonly string[]).includes(value) ? (value as KycStatus) : undefined

const parseKind = (value: string | null): VehicleKind =>
    value === "trailer" || value === "link" ? value : "truck"

const parseWindow = (value: string | null): number | undefined => {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 365 ? parsed : undefined
}

/**
 * The URL is the state store: the header writes these params and the data
 * view reads them, so the query key derives from the URL and the server
 * prefetch can build the exact same input. Shared by both sides.
 */
export const partnersListInput = (get: (key: string) => string | null) => ({
    search: get("search")?.trim() || undefined,
    status: parseStatus(get("status")),
    expiring: parseWindow(get("expiring")),
})

/** Every URL key the stat cards and filter bar own, for clearing on switch. */
export const FILTER_KEYS = ["status", "expiring"] as const

/**
 * The horizon the "expiring" stat card and its list filter both use. Lives
 * here, not in the server module, so the client can read it without pulling
 * drizzle into the bundle.
 */
export const EXPIRY_WINDOW_DAYS = 30

export const vehiclesListInput = (get: (key: string) => string | null) => ({
    ...partnersListInput(get),
    kind: parseKind(get("kind")),
})

export const currentView = (get: (key: string) => string | null): VIEW =>
    get("view") === "grid" ? "grid" : "list"

export const currentKind = (get: (key: string) => string | null) => parseKind(get("kind"))
