import type { Location } from "@workspace/db/orders";
import type {
    MovementCostKind,
    MovementDocumentLeg,
    MovementDocumentType,
    MovementEventKind,
    MovementExecution,
    MovementStatus,
} from "@workspace/db/movements";
import type { CATEGORIES, FISCAL_REGIME, ROUTE_TYPE, WEIGHT_UNIT } from "@workspace/db/types";
import type { MovementRole } from "@workspace/domain/movements/policy";
import type { EditableGroup } from "@workspace/domain/movements/policy";
import type { CostTotal, Currency, PaymentStatus } from "@workspace/domain/movements/money";
import type { TransitionBlocker } from "@workspace/domain/movements/status";

export type {
    CostTotal,
    Currency,
    EditableGroup,
    Location,
    MovementCostKind,
    MovementDocumentLeg,
    MovementDocumentType,
    MovementEventKind,
    MovementExecution,
    MovementRole,
    MovementStatus,
    PaymentStatus,
    TransitionBlocker,
};

export type Category = (typeof CATEGORIES)[number];
export type FiscalRegime = (typeof FISCAL_REGIME)[number];
export type RouteType = (typeof ROUTE_TYPE)[number];
export type WeightUnit = (typeof WEIGHT_UNIT)[number];

// ---------------------------------------------------------------------------
// The two lists. One table, two pages: Orders is every load somebody else
// moves for this company — the ones it placed with a partner, and the ones a
// transporter on the portal filed naming it as the client — plus the loads
// partners have offered it. Trips is every load its own fleet moves.
// ---------------------------------------------------------------------------

export const MOVEMENT_SCOPES = ["orders", "trips"] as const;
export type MovementScope = (typeof MOVEMENT_SCOPES)[number];

export const ORDER_SECTIONS = ["all", "inbox", "procurement", "booked", "in-transit", "delivered", "history"] as const;
export type OrderSection = (typeof ORDER_SECTIONS)[number];

export const TRIP_SECTIONS = ["all", "planning", "scheduled", "in-transit", "delivered", "history"] as const;
export type TripSection = (typeof TRIP_SECTIONS)[number];

export type MovementSection = OrderSection | TripSection;

export const MOVEMENT_SORTS = ["newest", "loading", "delivery"] as const;
export type MovementSort = (typeof MOVEMENT_SORTS)[number];

export const PAGE_SIZES = [25, 50, 100] as const;

export type PagedResult<T> = {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
};

// ---------------------------------------------------------------------------
// What a caller may see. Built field by field in server/projection.ts — never
// by spreading a row — so a column added to the table next month cannot ride
// out to a company that has no business reading it.
// ---------------------------------------------------------------------------

/** Another company on the load, as the caller may know it. */
export type MovementParty = {
    id: string | null;
    name: string | null;
};

/** One side of the deal, in the caller's own terms. */
export type MoneyLeg = {
    subtotal: number | null;
    vat: number | null;
    total: number;
    currency: Currency;
    fiscalRegime: FiscalRegime | null;
    invoiceNumber: string | null;
    invoiceDate: Date | null;
    settlement: PaymentStatus;
    /** Received on a leg the caller is paid, paid on one it pays */
    settled: number;
    settledAt: Date | null;
};

export type MarginView = {
    gross: { amount: number; currency: Currency } | null;
    net: { amount: number; currency: Currency } | null;
    blocked: "CURRENCY_MISMATCH" | "MISSING_LEG" | null;
    costs: CostTotal[];
};

/**
 * The money one caller may see. The same two legs read differently from
 * each side of the table: the owner pays its partner (payable) and bills its
 * client (receivable); the executor is only ever shown what it will be paid,
 * the client only what it will pay. The margin — and the costs it is made
 * of — is the owner's alone.
 */
export type MovementMoney = {
    payable: MoneyLeg | null;
    receivable: MoneyLeg | null;
    margin: MarginView | null;
};

export type MovementPing = {
    recordedAt: Date;
    latitude: number;
    longitude: number;
    placeName: string | null;
};

export type MovementRow = {
    id: string;
    ref: string;
    execution: MovementExecution;
    status: MovementStatus;
    role: MovementRole;
    origin: Location;
    destination: Location;
    cargoDescription: string | null;
    expectedLoadingDate: Date | null;
    expectedDeliveryAt: Date | null;
    startedAt: Date | null;
    deliveredAt: Date | null;
    /** Who the load belongs to — shown to the executor and the client, null to the owner */
    owner: MovementParty | null;
    /** Who it is for — the owner's own business, so null to anybody else */
    client: MovementParty | null;
    /** Who moves it — the owner's own business, so null to anybody else */
    carrier: MovementParty | null;
    driverName: string | null;
    truckPlate: string | null;
    /** The headline figure of each leg the caller may see */
    payable: { total: number; currency: Currency } | null;
    receivable: { total: number; currency: Currency } | null;
    /** Owner only: an executor on the portal holds the truck */
    isLinked: boolean;
    lastPing: MovementPing | null;
    pingCount: number;
    version: number;
    createdAt: Date;
};

export type MovementCostView = {
    id: string;
    kind: MovementCostKind;
    description: string | null;
    amount: number;
    currency: Currency;
    incurredAt: Date;
    rechargeable: boolean;
    createdAt: Date;
};

export type MovementDocumentView = {
    id: string;
    type: MovementDocumentType;
    leg: MovementDocumentLeg | null;
    title: string | null;
    url: string;
    size: number | null;
    mimeType: string | null;
    costId: string | null;
    uploadedByName: string | null;
    /** A proof filed on the row with the truck, shown here; it is removed there, not here */
    fromExecutor: boolean;
    createdAt: Date;
};

export type MovementEventView = {
    id: string;
    kind: MovementEventKind;
    fromStatus: MovementStatus | null;
    toStatus: MovementStatus | null;
    note: string | null;
    /** What happened to an offer, a conversion or a payment */
    action: string | null;
    /** Where a paper was emailed, when it was emailed rather than filed */
    sentTo: string | null;
    /** The company that acted; null when the move was carried up from below */
    actorName: string | null;
    createdAt: Date;
};

/** A move the owner can see on the table, and whether it can be taken now. */
export type TransitionOption = {
    to: MovementStatus;
    /** Why the move cannot be taken yet, or null */
    blocker: TransitionBlocker | null;
    /** The move is open, but only with a reason on record */
    needsNote: boolean;
};

/** What the caller may do with this load right now, decided server-side. */
export type MovementPermissions = {
    transitions: TransitionOption[];
    editable: EditableGroup[];
    canOffer: boolean;
    canWithdraw: boolean;
    canRespond: boolean;
    canConvert: boolean;
    canManageCosts: boolean;
    canManageDocuments: boolean;
    canRecordPayment: boolean;
    canRequestLocation: boolean;
};

export type MovementDetail = MovementRow & {
    route: RouteType;
    category: Category | null;
    weight: number | null;
    weightUnit: WeightUnit | null;
    closedAt: Date | null;
    trackingEnabled: boolean;
    notes: string | null;
    /** Owner and client only: the client's own purchase-order number */
    clientReference: string | null;
    /** Owner only: where the partner is written to, when it is on the portal */
    carrierEmail: string | null;
    /** Owner only: its own driver, or the partner's it was told about */
    driverPhone: string | null;
    driverId: string | null;
    truckId: string | null;
    trailerId: string | null;
    /** Owner only: the assigned trailer's plate, which papers have to name */
    trailerPlate: string | null;
    linkId: string | null;
    /** Partner loads: the offer round, as far as the caller is part of it */
    offeredAt: Date | null;
    respondedAt: Date | null;
    responseNote: string | null;
    /** This row is an executor's copy of an order another company placed */
    hasParent: boolean;
    money: MovementMoney;
    costs: MovementCostView[];
    documents: MovementDocumentView[];
    events: MovementEventView[];
    permissions: MovementPermissions;
    updatedAt: Date;
};

/** What the load form picks from; every pick is checked again server-side. */
export type LoadFormOptions = {
    /** Accepted connections, either way round */
    partners: Array<{ id: string; name: string; type: OrgType; onPortal: boolean }>;
    drivers: Array<{ id: string; name: string; phone: string | null }>;
    trucks: Array<{ id: string; plate: string }>;
};

export type MovementStats = {
    total: number;
    bySection: Record<string, number>;
    /** Orders only: loads partners have offered this company, awaiting its answer */
    inbox: number;
    /** On the road, asked for a position today, and silent since midnight */
    silent: number;
};

// ---------------------------------------------------------------------------
// The list pages. The section is the route segment, never a query param, so
// a shared link opens the list the sender meant; everything else the table
// can be cut by lives in the query string, and the same parser feeds the
// server prefetch and the client query so the first page hydrates.
// ---------------------------------------------------------------------------

export type OrgType = "carrier" | "shipper";

export type SortDir = "asc" | "desc";

export const DEFAULT_SORT: MovementSort = "newest";
export const DEFAULT_DIR: SortDir = "desc";
export const DEFAULT_PAGE_SIZE = 25;

export const sectionsOf = (scope: MovementScope): readonly MovementSection[] =>
    scope === "orders" ? ORDER_SECTIONS : TRIP_SECTIONS;

/** Whether a URL segment is a section of this list. */
export const isScopeSection = (scope: MovementScope, value: string | undefined): value is MovementSection =>
    value !== undefined && (sectionsOf(scope) as readonly string[]).includes(value);

/** Where `/orders` and `/trips` land: everything, newest first. */
export const DEFAULT_SECTION = "all" as const satisfies OrderSection & TripSection;

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

/** The list input for one section page; the scope and section come from the route. */
export const movementsListInput = (scope: MovementScope, section: MovementSection, get: Get) => ({
    scope,
    section,
    search: get("search")?.trim() || undefined,
    /** Asked for a position today and still silent — the tile's filter */
    silent: get("silent") === "1" ? (true as const) : undefined,
    sort: oneOf(get("sort"), MOVEMENT_SORTS) ?? DEFAULT_SORT,
    dir: get("dir") === "asc" ? ("asc" as const) : DEFAULT_DIR,
    page: parsePage(get("page")),
    pageSize: parsePageSize(get("size")),
});

export type MovementsListInput = ReturnType<typeof movementsListInput>;

/** Every URL key a filter control owns, so "nothing yet" is told from "nothing matched". */
export const FILTER_KEYS = ["search", "silent"] as const;

export const isFilteredMovements = (get: Get) => FILTER_KEYS.some((key) => Boolean(get(key)));

/**
 * Which of the two lists a load belongs to, for the caller: a load its own
 * fleet moves is a trip; everything else it can see — a load it placed with
 * a partner, one a partner offered it, one somebody moves for it — is on
 * Orders. The detail page's way back is decided from this.
 */
export const scopeOf = (load: Pick<MovementRow, "execution" | "role">): MovementScope =>
    load.execution === "own-fleet" && load.role === "owner" ? "trips" : "orders";

/** The section of that list a load sits in right now. */
export function sectionOf(load: Pick<MovementRow, "execution" | "role" | "status">): MovementSection {
    const { status } = load;

    if (status === "closed" || status === "cancelled") return "history";
    if (status === "in-transit" || status === "delivered") return status;

    if (scopeOf(load) === "trips") return status === "scheduled" ? "scheduled" : "planning";

    if (load.role === "executor" && status === "offered") return "inbox";

    return status === "scheduled" ? "booked" : "procurement";
}
