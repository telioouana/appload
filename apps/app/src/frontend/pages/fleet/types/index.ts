import { FLEET_STATUS, KYC_STATUS, OWNERSHIP_STATUS, TRUCK_TYPE } from "@workspace/db/types";
import type { KycStatus, LoadingBay, OwnershipStatus } from "@workspace/db/types";

import type { VehicleKind } from "@/backend/schemas/register-fleet";

export type { VehicleKind };

// The two fleet vocabularies ship as tuples only, so the unions are derived
// here rather than in packages/db (which Admin shares unchanged)
export type FleetStatus = (typeof FLEET_STATUS)[number];
export type TruckType = (typeof TRUCK_TYPE)[number];

/**
 * The three vehicle kinds are three routes (`/fleet/trucks`, `/frota/links`…)
 * rather than a filter, so the segment is a plural English slug in both
 * locales and this map is the only place it becomes a table name.
 */
export const KIND_SLUGS = {
    trucks: "truck",
    trailers: "trailer",
    links: "link",
} as const;

export type KindSlug = keyof typeof KIND_SLUGS;

export const KIND_SLUG_LIST = Object.keys(KIND_SLUGS) as KindSlug[];

/** The slug for a kind, for links built from a row rather than the URL. */
export const SLUG_FOR_KIND: Record<VehicleKind, KindSlug> = {
    truck: "trucks",
    trailer: "trailers",
    link: "links",
};

/** The kind a route segment names, or null when the segment is not one. */
export const kindFromSlug = (slug: string): VehicleKind | null =>
    slug in KIND_SLUGS ? KIND_SLUGS[slug as KindSlug] : null;

// ---------------------------------------------------------------------------
// Paging, sorting and filtering vocabulary. Shared by the URL parser below,
// the server procedures and the toolbar, so one list of allowed values
// governs all three.
// ---------------------------------------------------------------------------

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export type SortDir = "asc" | "desc";

export const VEHICLE_SORTS = ["plate", "status", "year", "created"] as const;
export type VehicleSort = (typeof VEHICLE_SORTS)[number];

/** The status tabs: every KYC status plus one bucket for the problem states. */
export const STATUS_FILTERS = [...KYC_STATUS, "issues"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const ISSUE_STATUSES: KycStatus[] = ["rejected", "expired", "suspended"];

/** Operational availability, independent of verification. */
export const FLEET_STATES = FLEET_STATUS;

// ---------------------------------------------------------------------------
// Row and stats shapes the views consume
// ---------------------------------------------------------------------------

export type DocProgress = { approved: number; required: number };

export type StatusCounts = Record<KycStatus, number>;

export type VehicleStats = {
    total: number;
    byStatus: StatusCounts;
    /** rejected + expired + suspended */
    issues: number;
    /** Operational availability counts, one per FLEET_STATUS value */
    byState: Record<FleetStatus, number>;
    /** Each key matches the URL filter its tile opens */
    attention: {
        ownership: number;
        unassigned: number;
    };
};

export type VehicleRow = {
    id: string;
    kind: VehicleKind;
    regPlate: string;
    internalId: string | null;
    brand: string;
    model: string;
    year: number;
    truckType: TruckType | null;
    capacity: number | null;
    bayType: LoadingBay["type"] | null;
    status: FleetStatus;
    kycStatus: KycStatus;
    ownershipStatus: OwnershipStatus;
    ownerName: string | null;
    progress: DocProgress;
    /** Trucks only: the driver whose home truck this is */
    driverId: string | null;
    driverName: string | null;
    /** Towed units: the plate of whatever they are hitched to */
    hitchedTo: string | null;
};

export type VehicleDocument = {
    type: string;
    status: "pending" | "approved" | "rejected";
    expiresAt: string | null;
};

export type VehicleProfile = Omit<VehicleRow, "driverId" | "driverName"> & {
    vin: string;
    ownerNuit: string | null;
    loadingBay: LoadingBay | null;
    createdAt: Date;
    documents: VehicleDocument[];
    drivers: { id: string; name: string; kycStatus: KycStatus }[];
};

export type PagedResult<T> = {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
};

// ---------------------------------------------------------------------------
// URL parsing. The URL is the state store: the toolbar writes these params
// and the data view reads them, so the query key derives from the URL and the
// server prefetch can build the exact same input. The kind is the one thing
// that does not come from the query string — it is the route segment.
// ---------------------------------------------------------------------------

type Get = (key: string) => string | null;

const oneOf = <T extends readonly string[]>(value: string | null, allowed: T): T[number] | undefined =>
    value && (allowed as readonly string[]).includes(value) ? (value as T[number]) : undefined;

const parsePage = (value: string | null): number => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
};

const parsePageSize = (value: string | null): number => {
    const parsed = Number(value);
    return (PAGE_SIZES as readonly number[]).includes(parsed) ? parsed : DEFAULT_PAGE_SIZE;
};

const parseDir = (value: string | null): SortDir => (value === "desc" ? "desc" : "asc");

const flag = (value: string | null): true | undefined => (value === "1" ? true : undefined);

const text = (value: string | null): string | undefined => value?.trim() || undefined;

export const vehiclesListInput = (kind: VehicleKind, get: Get) => ({
    kind,
    search: text(get("search")),
    status: oneOf(get("status"), STATUS_FILTERS),
    state: oneOf(get("state"), FLEET_STATES),
    ownership: oneOf(get("ownership"), OWNERSHIP_STATUS),
    unassigned: flag(get("unassigned")),
    sort: oneOf(get("sort"), VEHICLE_SORTS),
    page: parsePage(get("page")),
    pageSize: parsePageSize(get("size")),
    dir: parseDir(get("dir")),
});

export type VehiclesListInput = ReturnType<typeof vehiclesListInput>;

/** Every URL key a filter control owns, so a narrowed list is never a mystery. */
export const FILTER_KEYS = ["search", "status", "state", "ownership", "unassigned"] as const;
