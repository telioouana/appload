import { FLEET_STATUS, KYC_STATUS } from "@workspace/db/types";
import type { KycStatus } from "@workspace/db/types";

import type { DocProgress, FleetStatus, PagedResult, SortDir, StatusCounts } from "@/frontend/pages/fleet/types";
import type { Location, MovementExecution, MovementStatus } from "@/frontend/pages/movements/types";

export type { DocProgress, PagedResult };

// ---------------------------------------------------------------------------
// Paging, sorting and filtering vocabulary, shared by the URL parser below,
// the server procedures and the toolbar.
// ---------------------------------------------------------------------------

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export const DRIVER_SORTS = ["name", "status", "created"] as const;
export type DriverSort = (typeof DRIVER_SORTS)[number];

export const STATUS_FILTERS = [...KYC_STATUS, "issues"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const ISSUE_STATUSES: KycStatus[] = ["rejected", "expired", "suspended"];

export const FLEET_STATES = FLEET_STATUS;

/**
 * A driver registered without an email carries a stand-in address so the
 * account can exist at all. The list renders "no email" for these rather
 * than the placeholder itself, and the same test decides which rows the
 * profile invites the carrier to complete.
 */
export const EMAIL_PLACEHOLDER_SUFFIX = "@appload.invalid";

export const isPlaceholderEmail = (email: string | null | undefined): boolean =>
    !email || email.toLowerCase().endsWith(EMAIL_PLACEHOLDER_SUFFIX);

// ---------------------------------------------------------------------------
// Row and stats shapes the views consume
// ---------------------------------------------------------------------------

export type DriverStats = {
    total: number;
    byStatus: StatusCounts;
    issues: number;
    byState: Record<FleetStatus, number>;
    attention: {
        /** Drivers with no home truck */
        unassigned: number;
    };
};

export type DriverRow = {
    id: string;
    name: string;
    image: string | null;
    /** May be the `@appload.invalid` stand-in; the view shows "no email" then */
    email: string;
    phoneNumber: string | null;
    passport: string | null;
    status: FleetStatus;
    kycStatus: KycStatus;
    progress: DocProgress;
    truckId: string | null;
    plate: string | null;
};

export type DriverDocument = {
    type: string;
    status: "pending" | "approved" | "rejected";
    expiresAt: string | null;
};

/**
 * A load this driver was named on, as the profile lists it: where it goes
 * and how far along it is, and nothing of what it is worth — a driver's
 * page is a fleet page, not a money one.
 */
export type DriverLoad = {
    id: string;
    ref: string;
    status: MovementStatus;
    execution: MovementExecution;
    origin: Location;
    destination: Location;
};

export type DriverProfile = DriverRow & {
    createdAt: Date;
    documents: DriverDocument[];
    truck: { id: string; regPlate: string; brand: string; model: string } | null;
    /** The five most recent loads this driver was named on */
    loads: DriverLoad[];
};

// ---------------------------------------------------------------------------
// URL parsing — the same contract the fleet list uses
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

export const driversListInput = (get: Get) => ({
    search: text(get("search")),
    status: oneOf(get("status"), STATUS_FILTERS),
    state: oneOf(get("state"), FLEET_STATES),
    unassigned: flag(get("unassigned")),
    sort: oneOf(get("sort"), DRIVER_SORTS),
    page: parsePage(get("page")),
    pageSize: parsePageSize(get("size")),
    dir: parseDir(get("dir")),
});

export type DriversListInput = ReturnType<typeof driversListInput>;

export const FILTER_KEYS = ["search", "status", "state", "unassigned"] as const;
