import { KYC_STATUS, OWNERSHIP_STATUS } from "@workspace/db/types"
import type { Address, KycStatus, OwnershipStatus, RiskLevel } from "@workspace/db/types"

export type VehicleKind = "truck" | "trailer" | "link"

export const VEHICLE_KINDS: VehicleKind[] = ["truck", "trailer", "link"]

/** Whether the carrier holds a usable signed contract. */
export type ContractState = "valid" | "missing" | "expired"

export type DocProgress = { approved: number; required: number }

/** Inferred from the shipment status — there is no live telemetry. */
export type TripSummary = {
    /** Cargo is aboard and the rig is between the two addresses */
    inTransit: boolean
    from: string | null
    to: string | null
    load: string | null
}

// ---------------------------------------------------------------------------
// Paging, sorting and filtering vocabulary. Shared by the URL parsers below,
// the server procedures and the toolbar, so one list of allowed values
// governs all three.
// ---------------------------------------------------------------------------

export const PAGE_SIZES = [25, 50, 100] as const
export const DEFAULT_PAGE_SIZE = 25

export type SortDir = "asc" | "desc"

export const ORGANIZATION_SORTS = ["name", "status", "orders", "created"] as const
export const DRIVER_SORTS = ["name", "status", "carrier", "created"] as const
export const VEHICLE_SORTS = ["plate", "status", "carrier", "year", "created"] as const

/**
 * Whose fleet the drivers and vehicles pages list. Since the portal opened
 * fleet registration to shippers running their own trucks, the fleet tables
 * hold both — but a shipper's assets never go through verification (they can
 * never be on an Appload order), so the pages default to carriers: the list,
 * its tabs and its tiles then count exactly the assets somebody has to
 * review, and a shipper's fleet is one filter away rather than a permanent
 * column of "draft" rows in the KYC queue.
 */
export const OWNER_TYPES = ["carrier", "shipper", "all"] as const
export type OwnerType = (typeof OWNER_TYPES)[number]
export const DEFAULT_OWNER: OwnerType = "carrier"

export type OrganizationSort = (typeof ORGANIZATION_SORTS)[number]
export type DriverSort = (typeof DRIVER_SORTS)[number]
export type VehicleSort = (typeof VEHICLE_SORTS)[number]

/** The status tabs: every KYC status plus one bucket for the three problem states. */
export const STATUS_FILTERS = [...KYC_STATUS, "issues"] as const
export type StatusFilter = (typeof STATUS_FILTERS)[number]

export const ISSUE_STATUSES: KycStatus[] = ["rejected", "expired", "suspended"]

export const CONTRACT_FILTERS = ["valid", "missing"] as const
export type ContractFilter = (typeof CONTRACT_FILTERS)[number]

export const RISK_FILTERS = ["flagged", "watch", "high"] as const
export type RiskFilter = (typeof RISK_FILTERS)[number]

/**
 * Values the party sync scripts write when the spreadsheet had nothing —
 * the columns are NOT NULL UNIQUE, so a blank has to become *something*.
 * Written as LIKE patterns because the server filters on them directly;
 * `isPlaceholder` below turns the same patterns into a client-side check,
 * so the "incomplete" count and the dashed "Add …" cells always agree.
 */
export const PLACEHOLDER_PATTERNS = {
    nuit: ["MISSING-%", "DEV%"],
    email: ["%@appload.invalid", "%@dev.appload.local", "%@dev-drivers.appload.local"],
    phone: ["+000%", "+258000000%"],
} as const

export type PlaceholderField = keyof typeof PLACEHOLDER_PATTERNS

const likeToRegExp = (pattern: string) =>
    new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i")

const PLACEHOLDER_REGEXPS: Record<PlaceholderField, RegExp[]> = {
    nuit: PLACEHOLDER_PATTERNS.nuit.map(likeToRegExp),
    email: PLACEHOLDER_PATTERNS.email.map(likeToRegExp),
    phone: PLACEHOLDER_PATTERNS.phone.map(likeToRegExp),
}

/** True when the stored value is a sync placeholder rather than real data. */
export function isPlaceholder(field: PlaceholderField, value: string | null | undefined): boolean {
    if (!value) return true
    return PLACEHOLDER_REGEXPS[field].some((pattern) => pattern.test(value))
}

// ---------------------------------------------------------------------------
// Row and stats shapes the views consume
// ---------------------------------------------------------------------------

export type StatusCounts = Record<KycStatus, number>

export type StatsBucket = {
    total: number
    byStatus: StatusCounts
    /** rejected + expired + suspended */
    issues: number
    /** Subjects with an approved document running out within the window */
    expiring: number
    /** Per-page attention counts; each key matches the URL filter it opens */
    attention: {
        incomplete?: number
        contract?: number
        risk?: number
        phone?: number
        unassigned?: number
        ownership?: number
    }
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
    driverCount: number
}

/**
 * Whether a number is on WhatsApp, from our own chat history: proven by a
 * delivered message or a reply, disproven by a failed one, or never tried.
 */
export type WhatsappStatus = "confirmed" | "unreachable" | "unknown"

export type DriverRow = {
    id: string
    name: string
    image: string | null
    email: string
    phoneNumber: string | null
    whatsapp: WhatsappStatus
    passport: string | null
    carrierId: string
    carrierName: string | null
    kycStatus: KycStatus
    progress: DocProgress
    nextExpiry: string | null
    trip: TripSummary | null
    plate: string | null
    truckId: string | null
}

export type VehicleRow = {
    id: string
    kind: VehicleKind
    regPlate: string
    internalId: string | null
    brand: string
    model: string
    year: number
    truckType: "articulated" | "non-articulated" | null
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
    driverId: string | null
}

export type PagedResult<T> = {
    items: T[]
    total: number
    page: number
    pageSize: number
}

// ---------------------------------------------------------------------------
// URL parsing. The URL is the state store: the toolbar writes these params
// and the data view reads them, so the query key derives from the URL and
// the server prefetch can build the exact same input. Shared by both sides.
// ---------------------------------------------------------------------------

type Get = (key: string) => string | null

const oneOf = <T extends readonly string[]>(value: string | null, allowed: T): T[number] | undefined =>
    value && (allowed as readonly string[]).includes(value) ? (value as T[number]) : undefined

const parseKind = (value: string | null): VehicleKind =>
    value === "trailer" || value === "link" ? value : "truck"

const parseWindow = (value: string | null): number | undefined => {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 365 ? parsed : undefined
}

const parsePage = (value: string | null): number => {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

const parsePageSize = (value: string | null): number => {
    const parsed = Number(value)
    return (PAGE_SIZES as readonly number[]).includes(parsed) ? parsed : DEFAULT_PAGE_SIZE
}

const parseDir = (value: string | null): SortDir => (value === "desc" ? "desc" : "asc")

const flag = (value: string | null): true | undefined => (value === "1" || value === "true" ? true : undefined)

const text = (value: string | null): string | undefined => value?.trim() || undefined

const baseListInput = (get: Get) => ({
    search: text(get("search")),
    status: oneOf(get("status"), STATUS_FILTERS),
    expiring: parseWindow(get("expiring")),
    incomplete: flag(get("incomplete")),
    page: parsePage(get("page")),
    pageSize: parsePageSize(get("size")),
    dir: parseDir(get("dir")),
})

export const organizationsListInput = (get: Get) => ({
    ...baseListInput(get),
    sort: oneOf(get("sort"), ORGANIZATION_SORTS),
    contract: oneOf(get("contract"), CONTRACT_FILTERS),
    risk: oneOf(get("risk"), RISK_FILTERS),
    province: text(get("province")),
    claims: flag(get("claims")),
})

export const driversListInput = (get: Get) => ({
    ...baseListInput(get),
    sort: oneOf(get("sort"), DRIVER_SORTS),
    phone: get("phone") === "missing" ? ("missing" as const) : undefined,
    unassigned: flag(get("unassigned")),
    carrier: text(get("carrier")),
    owner: currentOwner(get),
})

export const vehiclesListInput = (get: Get) => ({
    ...baseListInput(get),
    sort: oneOf(get("sort"), VEHICLE_SORTS),
    kind: parseKind(get("kind")),
    ownership: oneOf(get("ownership"), OWNERSHIP_STATUS),
    unassigned: flag(get("unassigned")),
    carrier: text(get("carrier")),
    owner: currentOwner(get),
})

export type OrganizationsListInput = ReturnType<typeof organizationsListInput>
export type DriversListInput = ReturnType<typeof driversListInput>
export type VehiclesListInput = ReturnType<typeof vehiclesListInput>

/**
 * Every URL key a filter control owns. Changing any filter also drops the
 * page, so a narrower result set never opens on a page that no longer
 * exists.
 */
export const FILTER_KEYS = [
    "status",
    "expiring",
    "incomplete",
    "contract",
    "risk",
    "province",
    "ownership",
    "phone",
    "unassigned",
    "carrier",
    "owner",
    "claims",
    "page",
] as const

/**
 * The horizon the "expiring" tile and its list filter both use. Lives here,
 * not in the server module, so the client can read it without pulling
 * drizzle into the bundle.
 */
export const EXPIRY_WINDOW_DAYS = 30

export const currentKind = (get: Get) => parseKind(get("kind"))

/** Whose fleet the page lists; absent means carriers (see OWNER_TYPES). */
export function currentOwner(get: Get): OwnerType {
    return oneOf(get("owner"), OWNER_TYPES) ?? DEFAULT_OWNER
}
