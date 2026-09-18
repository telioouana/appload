import type { Location } from "@workspace/db/orders";
import type { OrderDocumentType, OrderHistoryKind } from "@workspace/db/orders";
import type { OrderRequestStatus } from "@workspace/db/quotes";
import type { OfferStatus, OrderStatus } from "@workspace/db/types";
import {
    CATEGORIES,
    CURRENCY,
    FISCAL_REGIME,
    LOAD_TYPE,
    PACKING,
    POD_STATUS,
    ROUTE_TYPE,
    TRIP_TYPE,
    TRUCK_AGE,
    WEIGHT_UNIT,
} from "@workspace/db/types";
import type { DispatchField } from "@workspace/domain/orders/dispatch-readiness";
import type { DispatchPack } from "@workspace/domain/orders/dispatch-pack";
import type { LoadingCheckState } from "@workspace/domain/orders/loading-check";
import type { TransitionRequirement } from "@workspace/domain/orders/transitions";
import type { TrackingAllowance } from "@workspace/domain/subscription";

export type { DispatchField, OfferStatus, OrderDocumentType, OrderRequestStatus, OrderStatus, TransitionRequirement };

// The vocabularies ship as tuples only, so the unions the DTOs need are
// derived here rather than in packages/db (which Admin shares unchanged)
export type Category = (typeof CATEGORIES)[number];
export type Currency = (typeof CURRENCY)[number];
export type FiscalRegime = (typeof FISCAL_REGIME)[number];
export type LoadType = (typeof LOAD_TYPE)[number];
export type Packing = (typeof PACKING)[number];
export type PodStatus = (typeof POD_STATUS)[number];
export type RouteType = (typeof ROUTE_TYPE)[number];
export type TripType = (typeof TRIP_TYPE)[number];
export type TruckAge = (typeof TRUCK_AGE)[number];
export type WeightUnit = (typeof WEIGHT_UNIT)[number];

export type OrgType = "shipper" | "carrier";

// ---------------------------------------------------------------------------
// Sections. The two sides of a deal watch the same orders from opposite ends,
// so they do not get the same pages: a shipper sees everything it filed and
// how far each order got, a carrier only ever sees the orders it was asked
// about, quoted for or is carrying.
// ---------------------------------------------------------------------------

/**
 * The shipper's pages. "requests" and "quoted" are two views of the same
 * prospect: one the carriers still owe an answer, the other has offers
 * waiting to be compared.
 */
export const SHIPPER_SECTIONS = [
    "all",
    "requests",
    "quoted",
    "booked",
    "on-going",
    "delivered",
    "history",
] as const;

/**
 * The carrier's pages. No "all": an order the carrier was never asked about
 * is not its business, and the five remaining pages already cover every
 * order it can see.
 */
export const CARRIER_SECTIONS = [
    "requests",
    "quoted",
    "booked",
    "on-going",
    "delivered",
    "history",
] as const;

/** Every section either side can ask for; each one is a route segment. */
export const ORDER_SECTIONS = [...SHIPPER_SECTIONS] as const;

export type OrderSection = (typeof SHIPPER_SECTIONS)[number];

export const sectionsFor = (orgType: OrgType): readonly OrderSection[] =>
    orgType === "carrier" ? CARRIER_SECTIONS : SHIPPER_SECTIONS;

/** Whether a URL segment is a page this organization type actually has. */
export const isSection = (orgType: OrgType, value: string | undefined): value is OrderSection =>
    value !== undefined && (sectionsFor(orgType) as readonly string[]).includes(value);

/** Where an absent or unknown section lands. */
export const defaultSection = (orgType: OrgType): OrderSection =>
    orgType === "carrier" ? "requests" : "all";

// ---------------------------------------------------------------------------
// Sorting and paging. One list of allowed values governs the server input;
// the lists themselves are the Orders page's now.
// ---------------------------------------------------------------------------

export type SortDir = "asc" | "desc";

export const ORDER_SORTS = ["newest", "loading", "status"] as const;

export type PagedResult<T> = {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
};

// ---------------------------------------------------------------------------
// Row and detail shapes the views consume. Money is projected per leg by the
// procedures: a shipper only ever receives its own leg and the client price
// of an offer, a carrier only its own leg and its own offer. Appload's
// commission never leaves the server.
// ---------------------------------------------------------------------------

/** What the tenant's own leg costs; the other party's leg is never selected. */
export type OrderMoney = {
    total: number | null;
    currency: Currency;
};

/** The same, split, for the detail page. */
export type OrderMoneyDetail = OrderMoney & {
    subtotal: number | null;
    vat: number | null;
};

/**
 * Where the request round stands, from the tenant's own side: a shipper sees
 * how many carriers it asked and how many answered, a carrier sees only what
 * became of its own request. The unused half is null.
 */
export type OrderRequestState = {
    requested: number | null;
    quoted: number | null;
    mine: OrderRequestStatus | null;
};

/** The carrier's own offer on the row, in its own money. */
export type OrderRowOffer = {
    id: string;
    status: OfferStatus;
    total: number;
    currency: Currency;
};

/** What the table shows of the rig; the full block is on the detail page. */
export type OrderRowDispatch = {
    driverName: string | null;
    truckPlate: string | null;
    trailerPlate: string | null;
};

/** Driver and rig, only once the order is booked (before that there are none). */
export type OrderDispatchView = {
    driverName: string | null;
    driverPhoneNumber: string | null;
    /** Carrier only: the shipper is told who is driving, not their document number */
    driverPassport: string | null;
    truckPlate: string | null;
    trailerPlate: string | null;
    linkPlate: string | null;
    truckAge: TruckAge | null;
};

export type OrderRow = {
    id: string;
    orderId: string;
    status: OrderStatus;
    route: RouteType;
    tripType: TripType;
    loadType: LoadType;
    category: Category;
    description: string;
    weight: number;
    weightUnit: WeightUnit;
    loadingAddress: Location;
    offloadingAddress: Location;
    expectedLoadingDate: Date;
    expectedOffloadingDate: Date | null;
    deliveries: number | null;
    expectedTrucks: number | null;
    /** The other side of the deal: the carrier for a shipper, the client for a carrier */
    counterparty: { name: string | null };
    money: OrderMoney;
    /** Carrier only: its own offer on this order, if it made one */
    myOffer: OrderRowOffer | null;
    requestState: OrderRequestState;
    /** Shipper only: offers still awaiting its decision */
    offersPending: number | null;
    /** Null until the order is booked */
    dispatch: OrderRowDispatch | null;
    podStatus: PodStatus | null;
    version: number;
    createdAt: Date;
};

/**
 * The tiles above the table. Every key is always present — the ones the other
 * organization type owns are simply 0 — so the views stay typed without a
 * union, and each key maps to the section (and filter) its tile opens:
 *
 *   awaitingOffers   shipper  → /orders/requests
 *   offersToReview   shipper  → /orders/quoted
 *   newRequests      carrier  → /orders/requests
 *   toDispatch       carrier  → /orders/booked?dispatch=1
 *   onTheRoad        both     → /orders/on-going
 *   deliveredPending both     → /orders/delivered
 */
export type OrderAttention = {
    awaitingOffers: number;
    offersToReview: number;
    newRequests: number;
    toDispatch: number;
    onTheRoad: number;
    deliveredPending: number;
};

export type OrderStats = {
    total: number;
    /** One count per section of this organization type; the others are 0 */
    bySection: Record<OrderSection, number>;
    attention: OrderAttention;
};

/**
 * One carrier offer as the tenant may see it. The amounts are already the
 * caller's own leg: a shipper receives the CLIENT price (what it would pay),
 * a carrier receives its own quote. Appload's commission is never here, and a
 * carrier only ever receives its own row.
 */
export type OrderOfferView = {
    id: string;
    carrierName: string;
    status: OfferStatus;
    subtotal: number | null;
    vat: number | null;
    total: number | null;
    currency: Currency;
    fiscalRegime: FiscalRegime;
    includesGit: boolean;
    includesGps: boolean;
    notes: string | null;
    /** The carrier's track record when the offer was written */
    carrierSince: Date | null;
    carrierTrips: number | null;
    decisionNote: string | null;
    decidedAt: Date | null;
    createdAt: Date;
    /** True when the offer belongs to the caller's own organization */
    isMine: boolean;
};

export type OrderRequestView = {
    id: string;
    carrierId: string;
    carrierName: string;
    status: OrderRequestStatus;
    message: string | null;
    respondedAt: Date | null;
    createdAt: Date;
};

export type OrderDocumentView = {
    id: string;
    type: OrderDocumentType;
    title: string | null;
    url: string;
    size: number | null;
    mimeType: string | null;
    uploadedByName: string | null;
    createdAt: Date;
};

/**
 * One timeline row. `metadata` is not forwarded: the fields below are the
 * whole projection, so the other party's money can never ride along in a
 * field nobody remembered to strip.
 */
export type OrderHistoryEntry = {
    id: string;
    kind: OrderHistoryKind;
    // The trail keeps the retired statuses the rows were written with, so
    // an old dispatch still renders as "to-loading" on the timeline
    fromStatus: OrderStatus | "to-loading" | null;
    toStatus: OrderStatus | "to-loading" | null;
    note: string | null;
    /** Document rows: what was uploaded */
    documentType: OrderDocumentType | null;
    /** Offer rows and bookings: the offer, in the caller's own money */
    offer: { id: string; carrierName: string; total: number | null; currency: Currency } | null;
    /** What happened to the offer ("created", "updated", "declined"…) */
    action: string | null;
    actorName: string | null;
    createdAt: Date;
};

/** What the caller may do with this order right now, decided server-side. */
export type OrderPermissions = {
    /** The order is the caller's own (shipper of it, or its booked carrier) */
    isMine: boolean;
    canCancel: boolean;
    canDispatch: boolean;
    canQuote: boolean;
    /** Carrier: at least one forward move is available */
    canTransition: boolean;
};

export type OrderDetail = {
    id: string;
    orderId: string;
    status: OrderStatus;
    source: string;
    route: RouteType;
    tripType: TripType;
    loadType: LoadType;
    category: Category;
    description: string;
    weight: number;
    weightUnit: WeightUnit;
    packing: Packing | null;
    isHazardous: boolean;
    hazchemCode: string | null;
    isRefrigerated: boolean;
    temperature: number | null;
    temperatureInstructions: string | null;
    loadingAddress: Location;
    offloadingAddress: Location;
    distance: number | null;
    deliveries: number | null;
    expectedTrucks: number | null;
    expectedLoadingDate: Date;
    expectedOffloadingDate: Date | null;
    actualLoadingDate: Date | null;
    actualOffloadingDate: Date | null;
    arrivalAtLoading: Date | null;
    arrivalAtOffloading: Date | null;
    arrivalAtBorder: Date | null;
    departureFromBorder: Date | null;
    counterparty: { id: string | null; name: string | null };
    money: OrderMoneyDetail;
    dispatch: OrderDispatchView | null;
    podStatus: PodStatus | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
    offers: OrderOfferView[];
    requests: OrderRequestView[];
    documents: OrderDocumentView[];
    /** The caller's own load behind this order, when it keeps one */
    linkedLoadId: string | null;
    permissions: OrderPermissions;
};

/**
 * The loading check as the order page reads it: the pack the truck left
 * with, what was confirmed at the site, and the photos taken there. Empty
 * for a carrier that merely quoted — the trip's papers belong to the two
 * parties to it.
 */
export type LoadingCheckView = {
    pack: DispatchPack | null;
    state: LoadingCheckState;
    /** Who recorded the check, when there is one */
    checkedByName: string | null;
    photos: LoadingPhotoView[];
    /** The shipper that ordered the load, and nobody else */
    canCheck: boolean;
};

export type LoadingPhotoView = {
    id: string;
    title: string | null;
    url: string;
    mimeType: string | null;
    createdAt: Date;
};

/** Why a move is advertised but not takeable. */
export type TransitionBlockedReason =
    | "NO_OFFERS"
    | "INCOMPLETE_FOR_DISPATCH"
    | "PAPERS_MISSING"
    | "SUBSCRIPTION_REQUIRED"
    | "QUOTA_EXCEEDED"
    | "LOADING_MISMATCH_REVIEW_REQUIRED"
    | "MANAGER_REQUIRED";

export type TransitionOption = {
    to: OrderStatus;
    requirements: TransitionRequirement[];
    blocked: boolean;
    blockedReason: TransitionBlockedReason | null;
    /**
     * Where the loading check stands, on the move into "loading" and
     * nowhere else: the dialog warns that an unchecked load flags the order
     */
    loadingCheck: LoadingCheckState | null;
};

export type TransitionOptions = {
    status: OrderStatus;
    /** The optimistic-lock handshake every mutation echoes back */
    version: number;
    /** Where an interrupted order resumes, derived from the timeline */
    resumeStatus: OrderStatus | null;
    targets: TransitionOption[];
    /**
     * This month's tracked movements, read only when the booking or the
     * dispatch is among the targets — the two moves a plan pays for
     */
    allowance: TrackingAllowance | null;
    /** What the order still lacks before it can be dispatched */
    missingForDispatch: DispatchField[];
    /** Shipper: offers still awaiting a decision */
    pendingOffers: number;
};
