import type { ContractStatus } from "@workspace/db/contracts";
import type { Location } from "@workspace/db/orders";
import type { PaymentLeg, RentalDayState } from "@workspace/db/rentals";
import type { CURRENCY, FISCAL_REGIME, PriceModel } from "@workspace/db/types";
import type { ContractRole } from "@workspace/domain/contracts/access";
import type { ContractState } from "@workspace/domain/contracts/state";
import type { LineBilling, MonthRow, PerDay, RentalDayView } from "@workspace/domain/rentals/billing";

export type { ContractRole, ContractState, ContractStatus, LineBilling, Location, MonthRow, PaymentLeg, PerDay, PriceModel, RentalDayState, RentalDayView };

export type Currency = (typeof CURRENCY)[number];
export type FiscalRegime = (typeof FISCAL_REGIME)[number];

export const RENTAL_STATES = ["draft", "proposed", "active", "closed"] as const satisfies readonly ContractState[];
export const RENTAL_TABS = ["own", "partners"] as const;
export type RentalTab = (typeof RENTAL_TABS)[number];
export const RENTAL_SORTS = ["newest", "period", "reference"] as const;
export type RentalSort = (typeof RENTAL_SORTS)[number];
export type SortDir = "asc" | "desc";
export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_SORT: RentalSort = "newest";
export const DEFAULT_DIR: SortDir = "desc";

export type PagedResult<T> = { items: T[]; total: number; page: number; pageSize: number };
export type Party = { id: string | null; name: string | null };

/** One truck at the client's service, with its log and what it comes to so far. */
export type RentalLineView = {
    id: string;
    truck: { id: string; plate: string } | null;
    truckPlate: string | null;
    driver: { id: string; name: string } | null;
    /** Who provides the truck; null is the owner's own fleet */
    provider: Party | null;
    /** What the owner pays the provider per day — owner and that provider only */
    buyPrice: PerDay | null;
    /** The line's own end, when the truck left early */
    endsOn: string | null;
    days: RentalDayView[];
    billing: LineBilling;
    statement: MonthRow[];
    /** How many days the whole period holds for this line; null while open */
    projectedDays: number | null;
    /** The driver's answer today, and whether he was asked and stayed silent */
    today: { answer: "yes" | "no" | null; silent: boolean };
    disputedDays: number;
    notes: string | null;
};

export type RentalRow = {
    id: string;
    ref: string;
    status: ContractStatus;
    state: ContractState;
    role: ContractRole;
    owner: { id: string; name: string };
    client: Party | null;
    site: Location | null;
    startsOn: string;
    endsOn: string | null;
    currency: Currency;
    /** Owner and client only */
    sellPrice: PerDay | null;
    trucks: string[];
    /** Billable days so far across the reader's lines, and the period's days when it has an end */
    billableDays: number;
    periodDays: number | null;
    /** What the reader's side comes to so far, in the order's currency */
    billable: number;
    attention: { disputed: number; saidNo: number; silent: number };
    createdAt: Date;
    updatedAt: Date;
};

export type RentalMoneyLine = {
    currency: Currency;
    /** The client's side: billable to date at the order's price, projected to the end when it has one, what came in */
    billable: number;
    projected: number | null;
    received: number;
    receivable: number;
    /** The owner's side towards the providers: billable to date at the lines' prices, what went out */
    payable: number;
    paid: number;
    outstanding: number;
};

export type RentalPaymentView = {
    id: string;
    allocationId: string | null;
    leg: PaymentLeg;
    amount: number;
    currency: Currency;
    paidAt: Date;
    reference: string | null;
};

export type RentalPermissions = {
    canEdit: boolean;
    canAddLine: boolean;
    canEndLine: boolean;
    /** May mark days on at least one line (the provider of the line, or the owner) */
    canMark: boolean;
    canDispute: boolean;
    canRecordPayment: boolean;
    canActivate: boolean;
    canAccept: boolean;
    canDecline: boolean;
    canClose: boolean;
};

export type RentalDetail = RentalRow & {
    clientReference: string | null;
    fiscalRegime: FiscalRegime | null;
    fileUrl: string | null;
    fileName: string | null;
    notes: string | null;
    version: number;
    lines: RentalLineView[];
    money: { lines: RentalMoneyLine[]; perLine: Array<{ allocationId: string; currency: Currency; billable: number; paid: number; outstanding: number }> };
    payments: RentalPaymentView[];
    permissions: RentalPermissions;
};

export type RentalStats = {
    total: number;
    byState: Record<ContractState, number>;
    attention: { disputed: number; saidNo: number; silent: number };
    money: RentalMoneyLine[];
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

export const rentalsListInput = (get: Get) => ({
    tab: oneOf(get("tab"), RENTAL_TABS) ?? ("own" as const),
    state: oneOf(get("status"), RENTAL_STATES),
    search: get("search")?.trim() || undefined,
    sort: oneOf(get("sort"), RENTAL_SORTS) ?? DEFAULT_SORT,
    dir: get("dir") === "asc" ? ("asc" as const) : DEFAULT_DIR,
    page: parsePage(get("page")),
    pageSize: parsePageSize(get("size")),
});

export type RentalsListInput = ReturnType<typeof rentalsListInput>;

export const FILTER_KEYS = ["search", "status"] as const;
export const isFilteredRentals = (get: Get) => FILTER_KEYS.some((key) => get(key));
