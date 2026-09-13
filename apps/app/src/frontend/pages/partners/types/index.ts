import type { Address, KycStatus, OrderStatus } from "@workspace/db/types";
import type { ConnectionRelation, ConnectionStatus, ConnectionVia } from "@workspace/db/connections";

import { PARTNER_RELATIONS } from "@/backend/schemas/partner";

export type OrgType = "shipper" | "carrier";

/** Which side asked: "outgoing" is a request this tenant sent. */
export const CONNECTION_DIRECTIONS = ["incoming", "outgoing"] as const;
export type ConnectionDirection = (typeof CONNECTION_DIRECTIONS)[number];

/**
 * The page's tabs. A shipper only ever connects to carriers, so it has one
 * list; a carrier has two, because the same connection table holds both the
 * clients it works for and the carriers it subcontracts to.
 *
 * "clients" and "transporters" are the same filter seen from either side
 * (relation `client-carrier`, accepted), which is what lets the URL parser
 * below resolve a missing `tab` without knowing the organization's type.
 */
export const PARTNER_TABS = ["clients", "transporters", "subcontractors", "requests"] as const;
export type PartnerTab = (typeof PARTNER_TABS)[number];

/** The tabs an organization type has; the first is what an absent `tab` means. */
export const tabsFor = (orgType: OrgType): PartnerTab[] =>
    orgType === "carrier" ? ["clients", "subcontractors", "requests"] : ["transporters", "requests"];

/** What a tab is a list of; "requests" is both relations, so it has none. */
export const relationForTab = (tab: PartnerTab): ConnectionRelation | undefined =>
    tab === "requests" ? undefined : tab === "subcontractors" ? "subcontract" : "client-carrier";

/** The counterpart's organization type for a relation, seen from `orgType`. */
export const counterpartType = (orgType: OrgType, relation: ConnectionRelation): OrgType =>
    relation === "subcontract" ? "carrier" : orgType === "carrier" ? "shipper" : "carrier";

/**
 * What the other company is to this one, in one word. The same relation
 * reads differently from each side — a `client-carrier` row is a client to
 * the carrier and a transporter to the shipper — so every label the page
 * shows is chosen from the tenant's own point of view.
 */
export type PartnerKind = "client" | "transporter" | "subcontractor";

export const partnerKind = (orgType: OrgType, relation: ConnectionRelation): PartnerKind =>
    relation === "subcontract" ? "subcontractor" : orgType === "carrier" ? "client" : "transporter";

/** Which relations this organization type may ask for. */
export const relationsFor = (orgType: OrgType): ConnectionRelation[] =>
    orgType === "carrier" ? [...PARTNER_RELATIONS] : ["client-carrier"];

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export const PARTNER_SORTS = ["partner", "since", "orders"] as const;
export type PartnerSort = (typeof PARTNER_SORTS)[number];

export type SortDir = "asc" | "desc";

/** Minimum characters before the partner search asks the server. */
export const SEARCH_MIN_CHARS = 2;

// ---------------------------------------------------------------------------
// Row and result shapes the views consume; the procedures return exactly these
// ---------------------------------------------------------------------------

/**
 * A company the tenant is not (yet) connected to. Deliberately narrow: name,
 * province and verification status are what a requester needs to recognise a
 * partner — the email, phone and NUIT stay behind an accepted connection.
 */
export type PartnerCandidate = {
    id: string;
    name: string;
    /** Shipper or carrier: the NUIT lookup can find either, and only one of them fits the relation */
    type: OrgType;
    province: string | null;
    kycStatus: KycStatus;
    /** The pair's connection whichever way it points, or null when there is none */
    connection: { id: string; status: ConnectionStatus; direction: ConnectionDirection } | null;
};

export type PartnerRow = {
    /** The connection's id — what `?id=` and every mutation take */
    id: string;
    relation: ConnectionRelation;
    status: ConnectionStatus;
    direction: ConnectionDirection;
    /** The note the requester attached, shown on the requests tab */
    message: string | null;
    respondedAt: Date | null;
    createdAt: Date;
    partner: {
        id: string;
        name: string;
        type: OrgType;
        province: string | null;
        kycStatus: KycStatus;
    };
    /** Orders the two companies have run together, either way round */
    sharedOrders: number;
};

export type PagedResult<T> = {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
};

export type PartnerStats = {
    /** Accepted connections per relation */
    accepted: Record<ConnectionRelation, number>;
    /** Pending requests waiting on this tenant's answer */
    incoming: number;
    /** Pending requests this tenant sent */
    outgoing: number;
};

/**
 * Where a transporter's signed contract with Appload stands, in the one word
 * that may cross the tenant boundary. A rejected submission reads as
 * `missing`: why Appload turned the paperwork down is between Appload and
 * that company, and what this side needs is only that there is nothing valid
 * to work under.
 */
export type PartnerContractState = "valid" | "missing" | "expired" | "pending";

export type SharedOrders = {
    total: number;
    lastLoadingDate: Date | null;
    byStatus: { status: OrderStatus; count: number }[];
};

export type PartnerProfile = {
    connection: {
        id: string;
        relation: ConnectionRelation;
        status: ConnectionStatus;
        direction: ConnectionDirection;
        acceptedVia: ConnectionVia | null;
        message: string | null;
        respondedAt: Date | null;
        createdAt: Date;
    };
    partner: {
        id: string;
        name: string;
        type: OrgType;
        province: string | null;
        kycStatus: KycStatus;
        /** Contact details and addresses only travel once the connection is accepted */
        email: string | null;
        phoneNumber: string | null;
        billingAddress: Address | null;
        physicalAddress: Address | null;
        /** Null for a shipper: only transporters sign a contract with Appload */
        contract: PartnerContractState | null;
    };
    /** Null until the connection is accepted */
    orders: SharedOrders | null;
};

// ---------------------------------------------------------------------------
// URL parsing. The URL is the state store: the tabs and the table write these
// params, the data view reads them, and the RSC prefetch builds the same input
// from the same parser so the first page hydrates instead of refetching.
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

const text = (value: string | null): string | undefined => value?.trim() || undefined;

/**
 * The tab the params ask for, without knowing the organization type: an
 * unknown or absent `tab` is the client-carrier list, which is the default
 * for both types. A `direction` tile always means the requests tab.
 */
const parseTab = (get: Get): PartnerTab => {
    if (get("direction")) return "requests";

    return oneOf(get("tab"), PARTNER_TABS) ?? "clients";
};

export const partnersListInput = (get: Get) => {
    const tab = parseTab(get);

    return {
        relation: relationForTab(tab),
        status: (tab === "requests" ? "pending" : "accepted") as ConnectionStatus,
        direction: tab === "requests" ? oneOf(get("direction"), CONNECTION_DIRECTIONS) : undefined,
        query: text(get("search")),
        sort: oneOf(get("sort"), PARTNER_SORTS),
        dir: parseDir(get("dir")),
        page: parsePage(get("page")),
        pageSize: parsePageSize(get("size")),
    };
};

export type PartnersListInput = ReturnType<typeof partnersListInput>;

/** The tab to highlight, which needs the organization's own type. */
export const currentTab = (get: Get, orgType: OrgType): PartnerTab => {
    const tabs = tabsFor(orgType);
    const asked = parseTab(get);

    return tabs.includes(asked) ? asked : (tabs[0] as PartnerTab);
};

/** Whether anything narrows the list beyond its tab. */
export const isFilteredList = (get: Get) => Boolean(get("search") || get("direction"));
