import { DISPUTE_LIABLE_PARTY, DISPUTE_REASON, DISPUTE_STATUS } from "@workspace/db/types"
import type { CURRENCY, DisputeLiableParty, DisputeReason, DisputeStatus, ORDER_STATUS } from "@workspace/db/types"

import { DEFAULT_PAGE_SIZE, PAGE_SIZES, type PagedResult, type SortDir } from "@/frontend/pages/partners/types"

export { DEFAULT_PAGE_SIZE, PAGE_SIZES }
export type { PagedResult, SortDir }

export const DISPUTE_SORTS = ["opened", "claimed", "status", "updated"] as const
export type DisputeSort = (typeof DISPUTE_SORTS)[number]

export const DEFAULT_SORT: DisputeSort = "opened"
export const DEFAULT_DIR: SortDir = "desc"

export const HOLD_SIDES = ["shipper", "carrier"] as const
export type HoldSide = (typeof HOLD_SIDES)[number]

/** One dispute with the order facts the table shows. */
export type DisputeRow = {
    id: string
    orderId: string
    orderStatus: (typeof ORDER_STATUS)[number]
    reason: DisputeReason
    status: DisputeStatus
    description: string
    claimedAmount: string | null
    claimedCurrency: (typeof CURRENCY)[number] | null
    liableParty: DisputeLiableParty | null
    holdShipperPayments: boolean
    holdCarrierPayments: boolean
    openedAt: Date
    openedByName: string | null
    resolvedAt: Date | null
    shipperName: string
    carrierName: string | null
    version: number
    updatedAt: Date
}

export type DisputeStats = {
    total: number
    byStatus: Record<DisputeStatus, number>
    /** Money claimed on active disputes, per currency */
    claimed: { currency: string; amount: number; count: number }[]
}

type Get = (key: string) => string | null

const oneOf = <T extends readonly string[]>(value: string | null, allowed: T): T[number] | undefined =>
    value && (allowed as readonly string[]).includes(value) ? (value as T[number]) : undefined

const parsePage = (value: string | null): number => {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

const parsePageSize = (value: string | null): number => {
    const parsed = Number(value)
    return (PAGE_SIZES as readonly number[]).includes(parsed) ? parsed : DEFAULT_PAGE_SIZE
}

export const parseDir = (value: string | null): SortDir => (value === "asc" ? "asc" : value === "desc" ? "desc" : DEFAULT_DIR)

const text = (value: string | null): string | undefined => value?.trim() || undefined

/** The list input built from the URL; shared by the server prefetch and the client. */
export const disputesListInput = (get: Get) => ({
    search: text(get("search")),
    status: oneOf(get("status"), DISPUTE_STATUS),
    reason: oneOf(get("reason"), DISPUTE_REASON),
    liable: oneOf(get("liable"), DISPUTE_LIABLE_PARTY),
    hold: oneOf(get("hold"), HOLD_SIDES),
    sort: oneOf(get("sort"), DISPUTE_SORTS),
    dir: parseDir(get("dir")),
    page: parsePage(get("page")),
    pageSize: parsePageSize(get("size")),
})

export type DisputesListInput = ReturnType<typeof disputesListInput>

export const FILTER_KEYS = ["search", "status", "reason", "liable", "hold"] as const

export const isFilteredDisputes = (get: Get) => FILTER_KEYS.some((key) => Boolean(get(key)))

export function withoutPaging<T extends { page: number; pageSize: number }>(input: T): Omit<T, "page" | "pageSize"> {
    const { page, pageSize, ...scope } = input
    void page
    void pageSize
    return scope
}
