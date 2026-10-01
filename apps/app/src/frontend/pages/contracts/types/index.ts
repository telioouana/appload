import type { ContractBasis, ContractStatus } from "@workspace/db/contracts";
import type { Location } from "@workspace/db/orders";
import type { CURRENCY, FISCAL_REGIME, PAYMENT_STATUS, PriceModel, WEIGHT_UNIT } from "@workspace/db/types";
import type { MovementExecution, MovementStatus } from "@workspace/db/movements";
import type { ContractRole } from "@workspace/domain/contracts/access";
import type { OrderMoney } from "@workspace/domain/contracts/money";
import type { ContractState } from "@workspace/domain/contracts/state";

export type { ContractBasis, ContractRole, ContractState, ContractStatus, Location, OrderMoney, PriceModel };

export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

export type Currency = (typeof CURRENCY)[number];
export type FiscalRegime = (typeof FISCAL_REGIME)[number];
export type WeightUnit = (typeof WEIGHT_UNIT)[number];
export type OrgType = "shipper" | "carrier";

export const CONTRACT_STATES = ["draft", "proposed", "active", "exhausted", "expired", "closed"] as const satisfies readonly ContractState[];

/** The two tabs: the contracts in the company's books, and the ones naming it. */
export const CONTRACT_TABS = ["own", "partners"] as const;
export type ContractTab = (typeof CONTRACT_TABS)[number];

export const CONTRACT_SORTS = ["newest", "period", "reference"] as const;
export type ContractSort = (typeof CONTRACT_SORTS)[number];
export type SortDir = "asc" | "desc";

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_SORT: ContractSort = "newest";
export const DEFAULT_DIR: SortDir = "desc";

export type PagedResult<T> = { items: T[]; total: number; page: number; pageSize: number };

export type ContractParty = { id: string | null; name: string | null };

export type ProgressView = {
    /** Null on an open share or contract: no ceiling */
    share: number | null;
    consumed: number;
    delivered: number;
    remaining: number | null;
    trips: number;
};

export type AllocationView = {
    id: string;
    /** Null is the owner's own fleet */
    carrier: ContractParty | null;
    /** Null is an open share */
    shareQty: number | null;
    /** Owner only on another company's share; a carrier reads its own */
    buyPrice: PriceModel | null;
    truck: { id: string; plate: string } | null;
    driver: { id: string; name: string } | null;
    truckPlate: string | null;
    notes: string | null;
    progress: ProgressView;
};

export type ContractRow = {
    id: string;
    ref: string;
    status: ContractStatus;
    state: ContractState;
    basis: ContractBasis;
    role: ContractRole;
    owner: { id: string; name: string };
    client: ContractParty | null;
    origin: Location | null;
    destination: Location | null;
    startsOn: string;
    /** Null is an open period: as long as the cargo lasts */
    endsOn: string | null;
    /** Null is an open contract */
    committedQty: number | null;
    weightUnit: WeightUnit | null;
    currency: Currency;
    /** The whole contract for the owner and the client; the caller's own share for a carrier */
    progress: Omit<ProgressView, "share">;
    allocationCount: number;
    createdAt: Date;
    updatedAt: Date;
};

export type ContractTripRow = {
    id: string;
    ref: string;
    status: MovementStatus;
    execution: MovementExecution;
    allocationId: string;
    expectedLoadingDate: Date | null;
    weight: number | null;
    weightUnit: WeightUnit | null;
    /** What the trip is worth to the reader: what it pays out, or what it earns */
    total: number | null;
    currency: Currency | null;
    /** Where that leg's settlement stands, and how much has moved against it */
    settlement: PaymentStatus | null;
    settled: number | null;
    /** The reader owns the row and may record a payment on it */
    canRecordPayment: boolean;
    createdAt: Date;
};

export type ContractPermissions = {
    canEdit: boolean;
    canAllocate: boolean;
    /** The owner makes it active — unless a client on the portal has to accept it first */
    canActivate: boolean;
    /** The client answers a proposal */
    canAccept: boolean;
    canDecline: boolean;
    canClose: boolean;
    /** The reader may file a trip under at least one share */
    canFileTrip: boolean;
};

export type ContractDetail = ContractRow & {
    clientReference: string | null;
    fiscalRegime: FiscalRegime | null;
    /** Owner and client only */
    sellPrice: PriceModel | null;
    fileUrl: string | null;
    fileName: string | null;
    notes: string | null;
    version: number;
    allocations: AllocationView[];
    trips: ContractTripRow[];
    /** The trips' money added up from where the reader stands (domain contracts/money.ts) */
    money: OrderMoney;
    permissions: ContractPermissions;
};

/** One currency's worth of the contracts on the tab, from the reader's side: what it pays, or what it is paid */
export type ContractMoneyLine = {
    currency: Currency;
    committed: number;
    drawn: number;
    remaining: number;
    /** What has moved on the trips so far, on the reader's side: in, or out */
    received: number;
    receivable: number;
    paid: number;
    outstanding: number;
};

export type ContractStats = {
    total: number;
    byState: Record<ContractState, number>;
    money: {
        lines: ContractMoneyLine[];
        /** Every line in meticais at the newest rate on file; null without one */
        total: (ContractMoneyLine & { rateDay: string }) | null;
    };
};

// ---------------------------------------------------------------------------
// URL → list input, shared by the server prefetch and the client view
// ---------------------------------------------------------------------------

type Get = (key: string) => string | null;

const oneOf = <T extends string>(value: string | null, options: readonly T[]): T | undefined =>
    value !== null && (options as readonly string[]).includes(value) ? (value as T) : undefined;

const parsePage = (value: string | null) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : 1;
};

const parsePageSize = (value: string | null) => {
    const n = Number(value);
    return (PAGE_SIZES as readonly number[]).includes(n) ? n : PAGE_SIZES[0];
};

export const contractsListInput = (get: Get) => ({
    tab: oneOf(get("tab"), CONTRACT_TABS) ?? ("own" as const),
    state: oneOf(get("status"), CONTRACT_STATES),
    search: get("search")?.trim() || undefined,
    sort: oneOf(get("sort"), CONTRACT_SORTS) ?? DEFAULT_SORT,
    dir: get("dir") === "asc" ? ("asc" as const) : DEFAULT_DIR,
    page: parsePage(get("page")),
    pageSize: parsePageSize(get("size")),
});

export type ContractsListInput = ReturnType<typeof contractsListInput>;

export const FILTER_KEYS = ["search", "status"] as const;
export const isFilteredContracts = (get: Get) => FILTER_KEYS.some((key) => get(key));
