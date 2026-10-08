"use client"

import { useCallback, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useIsFetching, useSuspenseQuery } from "@tanstack/react-query"

import { useNow, useTranslations } from "@workspace/i18n"
import { isAuthorized } from "@workspace/auth/user-permissions"
import { SUBSCRIPTION_PLAN } from "@workspace/db/types"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { ListCard } from "@workspace/ui/customs/list/list-card"
import { ListFooter } from "@workspace/ui/customs/list/list-footer"
import { ListToolbar } from "@workspace/ui/customs/list/list-toolbar"
import { FilterChoice } from "@workspace/ui/customs/list/filter-controls"
import { DataTable, useDataTable, type SortState } from "@workspace/ui/customs/list/data-table"
import { useListParams } from "@workspace/ui/hooks/use-list-params"
import { useStaffRole } from "@/frontend/pages/kyc/sections/document-checklist"
import { usePartnerProfile } from "@/frontend/pages/partners/hooks/use-partner-profile"
import { PartnerProfileSheet } from "@/frontend/pages/partners/views/partner-profile-sheet"
import { useSubscriptionColumns } from "@/frontend/pages/subscriptions/columns/subscription-columns"
import { SubscriptionDialog, type DialogSubject } from "@/frontend/pages/subscriptions/sections/subscription-dialog"
import {
    isFilteredList,
    ORGANIZATION_TYPES,
    PAGE_SIZES,
    SUBSCRIPTION_SORTS,
    SUBSCRIPTION_STATES,
    subscriptionsListInput,
    type SubscriptionRow,
} from "@/frontend/pages/subscriptions/types"

export function SubscriptionsDataView() {
    const t = useTranslations("Admin.subscriptions")
    const trpc = useTRPC()
    const now = useNow()

    const searchParams = useSearchParams()
    const { set } = useListParams()
    const get = useCallback((key: string) => searchParams.get(key), [searchParams])

    const input = subscriptionsListInput(get)
    const { data } = useSuspenseQuery(trpc.subscriptions.list.queryOptions(input))
    const isRefreshing = useIsFetching({ queryKey: trpc.subscriptions.list.pathKey() }) > 0

    const canEdit = isAuthorized(useStaffRole(), "subscription", ["update"])
    const [subject, setSubject] = useState<DialogSubject>(null)

    const profile = usePartnerProfile()
    const { open } = profile
    const onProfile = useCallback((row: SubscriptionRow) => open(row.id, "portal"), [open])

    const sort: SortState = { key: get("sort") ?? "name", dir: get("dir") === "desc" ? "desc" : "asc" }
    const onSort = (key: string, dir: "asc" | "desc") =>
        set([
            { key: "sort", value: key === "name" ? null : key },
            { key: "dir", value: dir === "asc" ? null : dir },
            { key: "page", value: null },
        ])

    const columns = useSubscriptionColumns({ now, onProfile })
    const table = useDataTable({
        columns,
        data: data.items,
        getRowId: (row) => row.id,
        storageKey: "appload.subscriptions.columns",
    })

    const chips = [
        ...(input.type ? [{ key: "type", label: t("filters.type"), value: t(`filters.type-options.${input.type}`) }] : []),
        ...(input.plan ? [{ key: "plan", label: t("filters.plan"), value: t(`plan.${input.plan}`) }] : []),
    ]

    return (
        <>
            <ListCard>
                <ListToolbar
                    table={table}
                    tabs={{
                        param: "status",
                        items: [
                            { value: "all", label: t("tabs.all"), count: data.counts.all },
                            ...SUBSCRIPTION_STATES.map((state) => ({ value: state, label: t(`tabs.${state}`), count: data.counts[state] })),
                        ],
                    }}
                    filterCount={chips.length}
                    activeFilters={chips}
                    sort={{
                        defaultValue: "name",
                        options: SUBSCRIPTION_SORTS.map((value) => ({ value, label: t(`sort.${value}`) })),
                    }}
                    filters={
                        <>
                            <FilterChoice
                                label={t("filters.type")}
                                param="type"
                                anyLabel={t("filters.any")}
                                options={ORGANIZATION_TYPES.map((value) => ({ value, label: t(`filters.type-options.${value}`) }))}
                            />
                            <FilterChoice
                                label={t("filters.plan")}
                                param="plan"
                                anyLabel={t("filters.any")}
                                options={SUBSCRIPTION_PLAN.map((value) => ({ value, label: t(`plan.${value}`) }))}
                            />
                        </>
                    }
                />

                <div className={cn("flex min-h-0 flex-1 flex-col transition-opacity", isRefreshing && "opacity-60")}>
                    <DataTable
                        table={table}
                        sort={sort}
                        onSort={onSort}
                        selectable={false}
                        onRowClick={canEdit ? (row) => setSubject(row) : undefined}
                        isFiltered={isFilteredList(get)}
                        activeRowId={profile.id}
                        empty={{
                            title: t("data.empty"),
                            description: t("data.empty-description"),
                            filtered: t("data.no-results"),
                        }}
                    />
                </div>

                <ListFooter page={data.page} pageSize={data.pageSize} total={data.total} pageSizes={PAGE_SIZES} />
            </ListCard>

            <SubscriptionDialog subject={subject} onOpenChange={() => setSubject(null)} />
            <PartnerProfileSheet subjectType="organization" />
        </>
    )
}
