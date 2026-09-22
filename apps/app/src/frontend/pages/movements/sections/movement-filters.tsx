"use client"

import { useQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { FilterChoice, FilterToggle } from "@workspace/ui/customs/list/filter-controls"
import { useListParams } from "@workspace/ui/hooks/use-list-params"

import { useTRPC } from "@/backend/api/client"
import type { MovementStats } from "@/frontend/pages/movements/types"

export const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const

const ANY = "__any"

/**
 * The body of the Filters popover, most-likely first: the partner on the
 * load, the loading period, then the on/off flags with the number of rows
 * each opens. Statuses are the tab strip and the driver, truck and
 * reference come from the search box, so none of those lives here. The
 * admin orders popover's portal sibling.
 */
export function MovementFilters({ stats }: { stats: MovementStats }) {
    const t = useTranslations("App.loads.filters")
    const trpc = useTRPC()

    // The same options the load form picks a partner from; fetched when the
    // popover first opens, cached with the form's own query
    const { data: options } = useQuery(trpc.movements.formOptions.queryOptions())

    return (
        <div className="flex flex-col gap-4">
            <FilterChoice
                label={t("partner")}
                param="partner"
                anyLabel={t("any")}
                options={(options?.partners ?? []).map((partner) => ({ value: partner.id, label: partner.name }))}
            />

            <PeriodFilter />

            <div className="flex flex-col gap-1 border-t pt-3">
                <FilterToggle label={t("silent")} hint={t("silent-hint")} param="silent" value="1" count={stats.silent} />
                <FilterToggle label={t("off-route")} hint={t("off-route-hint")} param="offRoute" value="1" count={stats.offRoute} />
                <FilterToggle label={t("disputed")} hint={t("disputed-hint")} param="disputed" value="1" count={stats.bySection.disputes} />
                <FilterToggle label={t("has-costs")} hint={t("has-costs-hint")} param="hasCosts" value="1" />
            </div>
        </div>
    )
}

/**
 * A month of the current year or a from/to pair, on the expected loading
 * date. The two are one filter: choosing a month clears the dates and vice
 * versa, and all three params travel in a single URL replace.
 */
function PeriodFilter() {
    const t = useTranslations("App.loads.filters")
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
            <span id="filter-period" className="text-muted-foreground text-xs font-medium">{t("period")}</span>

            <Select value={monthValue} onValueChange={chooseMonth}>
                <SelectTrigger size="sm" className="w-full" aria-labelledby="filter-period">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-72">
                    <SelectItem value={ANY}>{t("any")}</SelectItem>
                    {MONTHS.map((key, index) => (
                        <SelectItem key={key} value={String(index + 1)}>{t(`month.${key}`)}</SelectItem>
                    ))}
                </SelectContent>
            </Select>

            <div className="grid grid-cols-2 gap-2">
                {(["from", "to"] as const).map((key) => (
                    <label key={key} className="text-muted-foreground flex flex-col gap-1 text-xs">
                        {t(key)}
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
