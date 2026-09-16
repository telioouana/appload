import type { MESSAGE_DIRECTION, MESSAGE_STATUS } from "@workspace/db/chats";
import type { Location } from "@workspace/db/orders";
import type {
    MOVEMENT_IN_PROGRESS_STATUSES,
    MovementCostKind,
    MovementDisputeStatus,
    MovementDocumentLeg,
    MovementDocumentType,
    MovementEventKind,
    MovementExecution,
    MovementStatus,
} from "@workspace/db/movements";
import type { CATEGORIES, DisputeReason, FISCAL_REGIME, OrderStatus, PartnerOrgType, ROUTE_TYPE, WEIGHT_UNIT } from "@workspace/db/types";
import type { MovementRole } from "@workspace/domain/movements/policy";
import type { EditableGroup } from "@workspace/domain/movements/policy";
import type { CostTotal, Currency, PaymentStatus } from "@workspace/domain/movements/money";
import type { MovementFlag, TransitionBlocker } from "@workspace/domain/movements/status";
import type { OrderStatusKey } from "@workspace/ui/customs/badge/status-badge";

export type {
    CostTotal,
    Currency,
    DisputeReason,
    EditableGroup,
    Location,
    MovementCostKind,
    MovementDisputeStatus,
    MovementDocumentLeg,
    MovementDocumentType,
    MovementEventKind,
    MovementExecution,
    MovementFlag,
    MovementRole,
    MovementStatus,
    OrderStatusKey,
    PaymentStatus,
    TransitionBlocker,
};

export type Category = (typeof CATEGORIES)[number];
export type FiscalRegime = (typeof FISCAL_REGIME)[number];
export type RouteType = (typeof ROUTE_TYPE)[number];
export type WeightUnit = (typeof WEIGHT_UNIT)[number];

// ---------------------------------------------------------------------------
// One list, two tabs. One table, one page: the Orders page shows every load
// this company is on, cut by a tab. "My trucks" (scope `trips`) is every
// load its own fleet moves, plus the loads partners have offered it; the
// partners tab (scope `orders`) is every load somebody else moves for it —
// the ones it placed with a partner, and the ones a transporter on the
// portal filed naming it as the client. The scope names stay internal: the
// URL says `?tab=own | partners`.
// ---------------------------------------------------------------------------

// Own trucks first: that is the order the two tabs are shown in
export const MOVEMENT_SCOPES = ["trips", "orders"] as const;
export type MovementScope = (typeof MOVEMENT_SCOPES)[number];

export const MOVEMENT_TABS = ["own", "partners"] as const;
export type MovementTab = (typeof MOVEMENT_TABS)[number];

/**
 * Where a bare `/orders/<section>` lands: a transporter on its own trucks, a
 * client on the transporters moving for it. The one place the default is
 * decided — the layout's redirect, the server prefetch and the client query
 * all ask here.
 */
export const defaultTab = (orgType: OrgType): MovementTab => (orgType === "carrier" ? "own" : "partners");

export const scopeOfTab = (tab: MovementTab): MovementScope => (tab === "partners" ? "orders" : "trips");
export const tabOfScope = (scope: MovementScope): MovementTab => (scope === "orders" ? "partners" : "own");

/** The sections, the same seven on either tab. */
export const SECTIONS = ["all", "procurement", "booked", "in-progress", "delivered", "disputes", "history"] as const;
export type MovementSection = (typeof SECTIONS)[number];

/**
 * A truck on the load, from the loading site to offloading, in chain order.
 * Restated rather than imported, because this module ships to the browser and
 * the schema builds drizzle tables at import time; the tuple type pins it to
 * the schema's own list, so the two cannot drift.
 */
export const IN_PROGRESS_STATUSES = [
    "at-loading",
    "loading",
    "waiting-documents",
    "on-route",
    "stopped",
    "issue",
    "at-border",
    "at-offloading",
    "offloading",
] as const satisfies typeof MOVEMENT_IN_PROGRESS_STATUSES;

export const isInProgress = (status: MovementStatus): boolean =>
    (IN_PROGRESS_STATUSES as readonly MovementStatus[]).includes(status);

/**
 * The statuses a section's tabs narrow it to, per scope, in tab order, after
 * the "all" tab (which is no param at all). "prospect" stands for prospect
 * and offered both — the same wait for an answer, asked by hand or through
 * the portal — and the list reads it that way. Only a partner can turn a
 * load down, so Declined is a tab on the partners side alone. A section with
 * no entry has no tabs.
 */
export const STATUS_TABS: Record<MovementScope, Partial<Record<MovementSection, readonly MovementStatus[]>>> = {
    orders: {
        procurement: ["procurement", "prospect", "scheduled", "declined"],
        "in-progress": IN_PROGRESS_STATUSES,
    },
    trips: {
        procurement: ["procurement", "prospect", "scheduled"],
        "in-progress": IN_PROGRESS_STATUSES,
    },
};

/**
 * The colour a status is drawn in. The tokens live on the order vocabulary,
 * so each load status borrows the order status that means the same thing —
 * one pairing for the chip, the route map's pin and the overview map, so a
 * chip and a pin of one colour always agree. The truck's own chain is the
 * order's chain, stage for stage.
 */
const TONE: Record<MovementStatus, OrderStatus> = {
    "procurement": "prospect",
    "prospect": "prospect",
    "offered": "prospect",
    "declined": "cancelled",
    "scheduled": "booked",
    "booked": "booked",
    "at-loading": "at-loading",
    "loading": "loading",
    "waiting-documents": "waiting-documents",
    "on-route": "on-route",
    "stopped": "stopped",
    "issue": "issue",
    "at-border": "at-border",
    "at-offloading": "at-offloading",
    "offloading": "offloading",
    "delivered": "delivered",
    "closed": "completed",
    "cancelled": "cancelled",
};

export const movementTone = (status: MovementStatus): OrderStatus => TONE[status];

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
    /** "District or city, Province, Country" reverse-geocoded from the coordinates; null until resolved */
    placeLabel: string | null;
};

export type MovementRow = {
    id: string;
    ref: string;
    /** The Appload order this row is the tenant's side of, "APPL021.26"; null on its own loads */
    apploadOrderId: string | null;
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
    /** Covered by an open dispute, as far as the caller may know (see projection.ts) */
    inDispute: boolean;
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
    /** Loading photos only: when somebody who answers for the load validated it */
    approvedAt: Date | null;
    approvedByName: string | null;
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
    /** What the load was missing when this move was taken anyway */
    flags: MovementFlag[];
    createdAt: Date;
};

/** A move the owner can see on the table, and whether it can be taken now. */
export type TransitionOption = {
    to: MovementStatus;
    /** Why the move cannot be taken at all, or null */
    blocker: TransitionBlocker | null;
    /** The move is open, but only with a reason on record */
    needsNote: boolean;
    /** What the load would still be missing there — proceeding is allowed, and recorded */
    flags: MovementFlag[];
    /** The move puts a truck on the load: tracking starts, and the plan pays for it */
    startsTracking: boolean;
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
    /** Validating a loading photo: the owner of the load, at owner or admin level */
    canApproveDocuments: boolean;
    canRecordPayment: boolean;
    canRequestLocation: boolean;
    /** Reading the driver's WhatsApp thread: the owner of the row with the truck */
    canReadThread: boolean;
    /** Saying something went wrong with the load: any company on it, whatever its role */
    canOpenDispute: boolean;
};

/**
 * The dispute on a load, as the caller may read it. The description is shown
 * verbatim to every company on a covered row; who opened it is named only
 * where the caller may know that company (projection.ts).
 */
export type MovementDisputeView = {
    id: string;
    reason: DisputeReason;
    description: string;
    status: MovementDisputeStatus;
    openedAt: Date;
    /** The opener's relation to this row, and its name when the caller may know it */
    openedBy: { side: "you" | "owner" | "client" | "executor"; name: string | null };
    resolution: string | null;
    resolvedAt: Date | null;
    /** Only the company that opened it, at a role that may declare it settled */
    canResolve: boolean;
};

/**
 * One WhatsApp message between Appload and the load's driver. The thread
 * hangs off the driver's phone number rather than off the load, and the
 * portal only ever reads it: the asking is the tracking card's button, the
 * answering happens in WhatsApp.
 */
export type MovementThreadItem = {
    id: string;
    direction: (typeof MESSAGE_DIRECTION)[number];
    body: string;
    /** How far an outbound send got; inbound messages carry none */
    status: (typeof MESSAGE_STATUS)[number] | null;
    createdAt: Date;
};

export type MovementDetail = MovementRow & {
    /**
     * The Appload order this load follows, and which side of it this company
     * is on: the one that handed the load over, the one moving it, or one of
     * the carriers still being asked. Null on a load the tenant runs itself.
     */
    appload: { orderId: string; role: "orderer" | "executor" | "candidate" } | null;
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
    /** What the load is missing right now; the owner's own reading, empty for anybody else */
    flags: MovementFlag[];
    money: MovementMoney;
    costs: MovementCostView[];
    documents: MovementDocumentView[];
    events: MovementEventView[];
    /** The open dispute on the load, else the latest resolved one, else null */
    dispute: MovementDisputeView | null;
    permissions: MovementPermissions;
    updatedAt: Date;
};

/** What the load form picks from; every pick is checked again server-side. */
export type LoadFormOptions = {
    /** Accepted connections, either way round, with Appload pinned in front of them */
    partners: Array<{ id: string; name: string; type: PartnerOrgType | "appload"; onPortal: boolean }>;
    drivers: Array<{ id: string; name: string; phone: string | null }>;
    trucks: Array<{ id: string; plate: string }>;
};

export type MovementStats = {
    total: number;
    bySection: Partial<Record<MovementSection, number>>;
    /** Every status across the whole list, behind the tabs inside a section */
    byStatus: Partial<Record<MovementStatus, number>>;
    /** My trucks only: loads partners have offered this company, awaiting its answer */
    received: number;
    /** In progress, asked for a position today, and silent since midnight */
    silent: number;
};

// ---------------------------------------------------------------------------
// The list page. The section is the route segment, never a query param, so
// a shared link opens the list the sender meant; the tab and everything else
// the table can be cut by live in the query string, and the same parser
// feeds the server prefetch and the client query so the first page hydrates.
// ---------------------------------------------------------------------------

export type OrgType = "carrier" | "shipper";

export type SortDir = "asc" | "desc";

export const DEFAULT_SORT: MovementSort = "newest";
export const DEFAULT_DIR: SortDir = "desc";
export const DEFAULT_PAGE_SIZE = 25;

/** Whether a URL segment is a section of the list. */
export const isSection = (value: string | undefined): value is MovementSection =>
    value !== undefined && (SECTIONS as readonly string[]).includes(value);

/** Where `/orders` lands: everything, newest first. */
export const DEFAULT_SECTION = "all" as const satisfies MovementSection;

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

/**
 * The list input for one section page. The section comes from the route; the
 * tab (`?tab=own | partners`, the company's own default when absent) says
 * which list, and is sent on as the scope it reads.
 */
export const movementsListInput = (section: MovementSection, get: Get, orgType: OrgType) => {
    const scope = scopeOfTab(oneOf(get("tab"), MOVEMENT_TABS) ?? defaultTab(orgType));

    return {
        scope,
        section,
        /** A status tab inside the section; "all", or a status that is not one of its tabs, is no filter */
        status: oneOf(get("status"), STATUS_TABS[scope][section] ?? []),
        search: get("search")?.trim() || undefined,
        /** Asked for a position today and still silent — the tile's filter */
        silent: get("silent") === "1" ? (true as const) : undefined,
        sort: oneOf(get("sort"), MOVEMENT_SORTS) ?? DEFAULT_SORT,
        dir: get("dir") === "asc" ? ("asc" as const) : DEFAULT_DIR,
        page: parsePage(get("page")),
        pageSize: parsePageSize(get("size")),
    };
};

export type MovementsListInput = ReturnType<typeof movementsListInput>;

/** Every URL key a filter control owns, so "nothing yet" is told from "nothing matched". */
export const FILTER_KEYS = ["search", "status", "silent"] as const;

export const isFilteredMovements = (get: Get) => FILTER_KEYS.some((key) => Boolean(get(key)));

/**
 * Which tab a load is under, for the caller: a load its own fleet moves is
 * one of its trucks, and so is work a partner offered it — the truck it
 * answers with is its own; everything else it can see — a load it placed
 * with a partner, one somebody moves for it — is on the partners tab. The
 * detail page's way back is decided from this.
 */
export const scopeOf = (load: Pick<MovementRow, "execution" | "role" | "status">): MovementScope =>
    (load.execution === "own-fleet" && load.role === "owner") || load.role === "executor" ? "trips" : "orders";

/**
 * The section a load sits in right now; never "disputes", which cuts across
 * the statuses. An offer waiting on the caller's answer is procurement work
 * on its own trucks; once answered, the executor works the load from its own
 * row, and the order it was offered lives in no section of its list.
 */
export function sectionOf(load: Pick<MovementRow, "execution" | "role" | "status">): MovementSection {
    const { status } = load;

    if (load.role === "executor") return status === "offered" ? "procurement" : "all";
    if (status === "closed" || status === "cancelled") return "history";
    if (status === "delivered") return "delivered";
    if (isInProgress(status)) return "in-progress";
    if (status === "booked") return "booked";
    if (scopeOf(load) === "orders") return "procurement";

    return status === "procurement" || status === "prospect" || status === "scheduled" ? "procurement" : "all";
}
