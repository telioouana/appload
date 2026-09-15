"use client"

import { CATEGORIES } from "@workspace/db/types"

import { useTranslations } from "@workspace/i18n"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"

import { FilterChoice, FilterToggle } from "@workspace/ui/customs/list/filter-controls"
import { useListParams } from "@workspace/ui/hooks/use-list-params"
import {
    currentYear,
    FIRST_YEAR,
    LOADING_WINDOW_DAYS,
    PAYMENT_FILTERS,
    PAYMENT_PARTIES,
    type FilterOptions,
    type OrderStats,
} from "@/frontend/pages/orders/types"

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const

const ANY = "__any"

/**
 * The body of the Filters popover: category, the payment state and side,
 * the loading period, the year and a group of on/off flags with the
 * number of rows each opens. Statuses are the tab strip and parties come
 * from the search box, so neither lives here.
 */
export function OrderFilters({ stats, options }: { stats: OrderStats; options?: FilterOptions }) {
    const t = useTranslations("Admin.orders")

    const year = currentYear()
    // Newest first; the current year is the "any" entry because absent means current
    const years = Array.from({ length: year - FIRST_YEAR }, (_, index) => String(year - 1 - index))

    const categories = options?.categories.length
        ? options.categories.map((entry) => ({ value: entry.value, label: t(`header.filters.category.options.${entry.value}`), count: entry.count }))
        : CATEGORIES.map((value) => ({ value, label: t(`header.filters.category.options.${value}`) }))

    return (
        <div className="flex flex-col gap-4">
            <FilterChoice label={t("list.filters.category")} param="category" anyLabel={t("list.filters.any")} options={categories} />

            <div className="grid grid-cols-2 gap-3">
                <FilterChoice
                    label={t("list.filters.payment")}
                    param="payment"
                    anyLabel={t("list.filters.any")}
                    options={PAYMENT_FILTERS.map((value) => ({ value, label: t(`header.filters.payment.options.${value}`) }))}
                />
                <FilterChoice
                    label={t("list.filters.payment-by")}
                    param="paymentBy"
                    anyLabel={t("list.filters.either")}
                    options={PAYMENT_PARTIES.map((value) => ({ value, label: t(`header.filters.payment.by.${value}`) }))}
                />
            </div>

            <PeriodFilter />

            {years.length > 0 && (
                <FilterChoice
                    label={t("list.filters.year")}
                    param="year"
                    anyLabel={String(year)}
                    options={years.map((value) => ({ value, label: value }))}
                />
            )}

            <div className="flex flex-col gap-1 border-t pt-3">
                <FilterToggle label={t("list.filters.loading")} hint={t("list.filters.loading-due", { days: LOADING_WINDOW_DAYS })} param="loading" value={String(LOADING_WINDOW_DAYS)} count={stats.attention.loading} />
                <FilterToggle label={t("list.filters.interrupted")} hint={t("list.filters.interrupted-hint")} param="interrupted" value="1" count={stats.attention.interrupted} />
                <FilterToggle label={t("list.filters.flagged")} hint={t("list.filters.flagged-hint")} param="flagged" value="1" count={stats.attention.flagged} />
                <FilterToggle label={t("list.filters.pod")} hint={t("list.filters.pod-hint")} param="pod" value="pending" count={stats.attention.pod} />
                <FilterToggle label={t("list.filters.insurance")} hint={t("list.filters.insurance-hint")} param="insurance" value="pending" />
                <FilterToggle label={t("list.filters.disputed")} hint={t("list.filters.disputed-hint")} param="disputed" value="1" count={stats.attention.disputed} />
                <FilterToggle label={t("list.filters.hazardous")} param="hazardous" value="1" />
                <FilterToggle label={t("list.filters.refrigerated")} param="refrigerated" value="1" />
                <FilterToggle label={t("list.filters.regional")} hint={t("list.filters.regional-hint")} param="route" value="regional" />
            </div>
        </div>
    )
}

/**
 * A month or a from/to pair, on the expected loading date. The two are
 * one filter: choosing a month clears the dates and vice versa, and all
 * three params travel in a single URL replace.
 */
function PeriodFilter() {
    const t = useTranslations("Admin.orders")
    const { get, set } = useListParams()

    const month = get("month")
    const from = get("from") ?? ""
    const to = get("to") ?? ""
    const monthValue = month && Number(month) >= 1 && Number(month) <= 12 ? month : ANY

    const chooseMonth = (value: string) =>
        set([
            { key: "month", value: value === ANY ? null : value },
            { key: "from", value: null },
            { key: "to", value: null },
            { key: "page", value: null },
        ])

    const chooseDate = (key: "from" | "to", value: string) =>
        set([
            { key, value: value || null },
            { key: "month", value: null },
            { key: "page", value: null },
        ])

    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <span id="filter-period" className="text-muted-foreground text-xs font-medium">{t("list.filters.period")}</span>

            <Select value={monthValue} onValueChange={chooseMonth}>
                <SelectTrigger size="sm" className="w-full" aria-labelledby="filter-period">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-72">
                    <SelectItem value={ANY}>{t("list.filters.any")}</SelectItem>
                    {MONTHS.map((key, index) => (
                        <SelectItem key={key} value={String(index + 1)}>{t(`header.filters.period.month.options.${key}`)}</SelectItem>
                    ))}
                </SelectContent>
            </Select>

            <div className="grid grid-cols-2 gap-2">
                {(["from", "to"] as const).map((key) => (
                    <label key={key} className="text-muted-foreground flex flex-col gap-1 text-xs">
                        {t(`list.filters.${key}`)}
                        <input
                            type="date"
                            value={key === "from" ? from : to}
                            max={key === "from" && to ? to : undefined}
                            min={key === "to" && from ? from : undefined}
                            onChange={(event) => chooseDate(key, event.target.value)}
                            className="bg-input/50 text-foreground focus-visible:ring-ring/30 h-8 rounded-full px-3 text-sm outline-none focus-visible:ring-3"
                        />
                    </label>
                ))}
            </div>
        </div>
    )
}
