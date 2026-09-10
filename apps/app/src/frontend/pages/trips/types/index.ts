import type { Location } from "@workspace/db/orders";
import type { TrackingChannel, TrackingSlot, TrackingStatus } from "@workspace/db/chats";
import type { MovementStatus } from "@workspace/db/movements";

/**
 * The four statuses this page models. A movement carries more of them —
 * procurement and the offer pair belong to a load a partner executes — and
 * narrowing here keeps every switch in the trips UI exhaustive until the
 * movements rebuild widens it.
 */
export type TripStatus = Extract<MovementStatus, "scheduled" | "in-transit" | "delivered" | "cancelled">;

export type { Location };

/** The display reference a trip is known by, the way an order has "APPL021.26". */
export const tripRef = (seq: number) => `TRP-${seq}`;

// ---------------------------------------------------------------------------
// Sections. The page lists the tenant's STANDALONE trips only: a movement
// with an order behind it is already on Orders › on-going, and the /map
// overview is where the two kinds are seen together.
//
// "delivered" and "history" split the two ways a trip ends — the loads that
// arrived, and the ones that were called off before they did.
// ---------------------------------------------------------------------------

export const TRIP_SECTIONS = ["all", "scheduled", "in-transit", "delivered", "history"] as const;

export type TripSection = (typeof TRIP_SECTIONS)[number];

export const DEFAULT_SECTION: TripSection = "all";

// ---------------------------------------------------------------------------
// Paging and sorting. One list of allowed values governs the URL parser, the
// server input and the toolbar.
// ---------------------------------------------------------------------------

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export type SortDir = "asc" | "desc";

export const TRIP_SORTS = ["newest", "started", "expected"] as const;
export type TripSort = (typeof TRIP_SORTS)[number];

export const DEFAULT_SORT: TripSort = "newest";
export const DEFAULT_DIR: SortDir = "desc";

export type PagedResult<T> = {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
};

// ---------------------------------------------------------------------------
// Row and detail shapes the views consume; the procedures return exactly these
// ---------------------------------------------------------------------------

/** Where the driver last said they were. */
export type TripPing = {
    recordedAt: Date;
    latitude: number;
    longitude: number;
    /** The label the driver's phone attached to the pin, when it sent one */
    placeName: string | null;
};

export type TripRow = {
    id: string;
    ref: string;
    status: TripStatus;
    /**
     * Nullable because the column is: a movement can be filed before anyone
     * is driving it. Every trip this page creates names both.
     */
    driverName: string | null;
    driverPhone: string | null;
    truckPlate: string | null;
    origin: Location;
    destination: Location;
    startedAt: Date | null;
    expectedDeliveryAt: Date | null;
    deliveredAt: Date | null;
    /** The connected partner on the other side of the trip, when there is one */
    counterpartyName: string | null;
    /** True when the trip belongs to this tenant; a counterparty only reads it */
    isMine: boolean;
    lastPing: TripPing | null;
    pingCount: number;
};

/** One location request the tracking cron (or the owner) sent for the trip. */
export type TripRequestView = {
    id: string;
    /** Maputo calendar date, e.g. "2026-09-10" */
    slotDate: string;
    slot: TrackingSlot;
    attempt: number;
    channel: TrackingChannel;
    status: TrackingStatus;
    createdAt: Date;
};

/** What the caller may do with this trip right now, decided server-side. */
export type TripPermissions = {
    isMine: boolean;
    canStart: boolean;
    canDeliver: boolean;
    canCancel: boolean;
    canRequestLocation: boolean;
};

export type TripDetail = TripRow & {
    cargoDescription: string | null;
    /** The last few location requests, newest first */
    requests: TripRequestView[];
    createdAt: Date;
    updatedAt: Date;
    permissions: TripPermissions;
};

/**
 * The tiles above the table and the counts behind the section tabs. Each
 * attention number maps to the list its tile opens:
 *
 *   inTransit           → ?section=in-transit
 *   noResponseToday     → ?noResponse=1
 *   scheduled           → ?section=scheduled
 *   delivered           → ?section=delivered (deliveredThisMonth is the line under it)
 */
export type TripStats = {
    total: number;
    bySection: Record<TripSection, number>;
    attention: {
        inTransit: number;
        noResponseToday: number;
        scheduled: number;
        delivered: number;
        deliveredThisMonth: number;
    };
};

// ---------------------------------------------------------------------------
// URL parsing. The URL is the state store: the toolbar and the tiles write
// these params, the data view reads them, and the RSC prefetch builds the
// same input from the same parser so the first page hydrates instead of
// refetching.
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

const parseDir = (value: string | null): SortDir => (value === "asc" ? "asc" : DEFAULT_DIR);

const text = (value: string | null): string | undefined => value?.trim() || undefined;

export const tripsListInput = (get: Get) => ({
    section: oneOf(get("section"), TRIP_SECTIONS) ?? DEFAULT_SECTION,
    search: text(get("search")),
    /** The tile: asked today and still silent — a slice of the trips in transit */
    noResponse: get("noResponse") === "1" ? (true as const) : undefined,
    sort: oneOf(get("sort"), TRIP_SORTS) ?? DEFAULT_SORT,
    dir: parseDir(get("dir")),
    page: parsePage(get("page")),
    pageSize: parsePageSize(get("size")),
});

export type TripsListInput = ReturnType<typeof tripsListInput>;

/** Every URL key a filter control owns, so "nothing yet" is told from "nothing matched". */
export const FILTER_KEYS = ["search", "noResponse"] as const;

export const isFilteredTrips = (get: Get) => FILTER_KEYS.some((key) => Boolean(get(key)));
