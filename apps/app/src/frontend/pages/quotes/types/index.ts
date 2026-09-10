import type { CURRENCY, FISCAL_REGIME, LOADING_BAY, ROUTE_TYPE, WEIGHT_UNIT } from "@workspace/db/types";
import type { Location } from "@workspace/db/orders";
import type { QuoteStatus } from "@workspace/db/quotes";

export type { QuoteStatus };
export type { Location };

/**
 * The vocabularies this feature renders, as unions. The tuples live in
 * `@workspace/db/types`, which builds nothing at import time — but the type
 * aliases are re-derived here so a view can name a currency without pulling
 * the database package into its own imports.
 */
export type Currency = (typeof CURRENCY)[number];
export type FiscalRegime = (typeof FISCAL_REGIME)[number];
export type LoadingBayType = (typeof LOADING_BAY)[number];
export type RouteType = (typeof ROUTE_TYPE)[number];
export type WeightUnit = (typeof WEIGHT_UNIT)[number];

export type OrgType = "shipper" | "carrier";

/**
 * The same table read from either side. A carrier sees the quotes it sent,
 * a client the quotes it received — one row set, one price, two headings.
 */
export const QUOTE_STATUSES = ["sent", "accepted", "declined", "withdrawn", "expired"] as const satisfies readonly QuoteStatus[];

export const QUOTE_SORTS = ["newest", "partner", "total", "valid"] as const;
export type QuoteSort = (typeof QUOTE_SORTS)[number];

export type SortDir = "asc" | "desc";

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export const DEFAULT_SORT: QuoteSort = "newest";
export const DEFAULT_DIR: SortDir = "desc";

/** Quotes whose validity runs out inside this many days count as expiring. */
export const EXPIRING_DAYS = 7;

// ---------------------------------------------------------------------------
// Row and result shapes the views consume; the procedures return exactly these
// ---------------------------------------------------------------------------

export type PagedResult<T> = {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
};

/**
 * The other company on the quote: the client for a carrier, the carrier for
 * a client. Narrow on purpose — the two are connected, and the profile panel
 * on the partners page is where the rest of the details live.
 */
export type QuoteParty = {
    id: string;
    name: string;
    province: string | null;
};

/**
 * What the quote costs. One price, seen the same way by both sides: a portal
 * quote carries no Appload commission, so what the carrier asks is what the
 * client would pay until staff price it in Admin.
 */
export type QuoteMoney = {
    subtotal: number | null;
    vat: number | null;
    total: number;
    currency: Currency;
};

export type QuoteRow = {
    id: string;
    status: QuoteStatus;
    /** The company on the other side of the quote */
    partner: QuoteParty;
    origin: Location;
    destination: Location;
    loadingDate: Date | null;
    route: RouteType;
    loadingBay: LoadingBayType | null;
    capacityWeight: number | null;
    capacityUnit: WeightUnit | null;
    money: QuoteMoney;
    includesGit: boolean;
    includesGps: boolean;
    validUntil: Date | null;
    /** The human order id the quote became, once it was accepted */
    orderRef: string | null;
    createdAt: Date;
};

export type QuoteDetail = QuoteRow & {
    fiscalRegime: FiscalRegime;
    notes: string | null;
    decidedAt: Date | null;
    updatedAt: Date;
    /** What this tenant may do with the quote, decided server-side */
    permissions: {
        /** The carrier's own side: a quote nobody has answered can be taken back */
        canWithdraw: boolean;
        /** The client's side: both decisions are open while the quote stands */
        canDecline: boolean;
        canAccept: boolean;
    };
};

export type QuoteStats = {
    total: number;
    byStatus: Record<QuoteStatus, number>;
    /** Standing quotes whose validity runs out within EXPIRING_DAYS */
    expiringSoon: number;
    /** Quotes accepted since the first of the current month */
    acceptedThisMonth: number;
};

// ---------------------------------------------------------------------------
// URL parsing. The URL is the state store: the toolbar and the table write
// these params, the data view reads them, and the RSC prefetch builds the same
// input from the same parser so the first page hydrates instead of refetching.
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

/** The params that narrow the list beyond its natural scope. */
export const FILTER_KEYS = ["search", "status", "expiring"] as const;

export const quotesListInput = (get: Get) => ({
    status: oneOf(get("status"), QUOTE_STATUSES),
    query: text(get("search")),
    // The tile is a slice of the standing quotes, not a status of its own
    expiring: get("expiring") === "1" ? (true as const) : undefined,
    sort: oneOf(get("sort"), QUOTE_SORTS) ?? DEFAULT_SORT,
    dir: parseDir(get("dir")),
    page: parsePage(get("page")),
    pageSize: parsePageSize(get("size")),
});

export type QuotesListInput = ReturnType<typeof quotesListInput>;

/** Whether anything narrows the list beyond "every quote this tenant is a side of". */
export const isFilteredQuotes = (get: Get) => FILTER_KEYS.some((key) => Boolean(get(key)));
