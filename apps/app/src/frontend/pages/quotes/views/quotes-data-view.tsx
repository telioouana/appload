"use client"

import { useCallback } from "react"
import { useIsFetching, useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { ListCard } from "@workspace/ui/customs/list/list-card"
import { ListFooter } from "@workspace/ui/customs/list/list-footer"
import { ListToolbar } from "@workspace/ui/customs/list/list-toolbar"
import { FilterToggle } from "@workspace/ui/customs/list/filter-controls"
import { DataTable, useDataTable } from "@workspace/ui/customs/list/data-table"
import { useQuoteColumns } from "@/frontend/pages/quotes/columns/quote-columns"
import { useQuotesList } from "@/frontend/pages/quotes/hooks/use-quotes-list"
import { useEntitySheet } from "@workspace/ui/hooks/use-entity-sheet"
import { QuoteSheet } from "@/frontend/pages/quotes/views/quote-sheet"
import {
    DEFAULT_DIR,
    DEFAULT_SORT,
    isFilteredQuotes,
    PAGE_SIZES,
    QUOTE_SORTS,
    quotesListInput,
    type QuoteRow,
} from "@/frontend/pages/quotes/types"

/**
 * The list card: the status strip, the table and the panel every row opens.
 * The table and the tiles read the same paged query, so the counts above and
 * the rows below can never disagree.
 */
export function QuotesDataView() {
    const t = useTranslations("App.quotes")
    const trpc = useTRPC()

    const { get, sort, onSort, statusTabs, activeFilters } = useQuotesList()
    const sheet = useEntitySheet()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())

    // The same builder the server prefetch used, so the first page hydrates
    // straight into this query instead of refetching
    const input = quotesListInput(get)

    const { data } = useSuspenseQuery(trpc.quotes.list.queryOptions(input))
    const { data: stats } = useSuspenseQuery(trpc.quotes.stats.queryOptions())
    const isRefreshing = useIsFetching({ queryKey: trpc.quotes.list.pathKey() }) > 0

    const { open } = sheet
    const onOpen = useCallback((row: QuoteRow) => open(row.id), [open])

    const orgType = session.organization.type

    const columns = useQuoteColumns()
    const table = useDataTable({
        columns,
        data: data.items,
        getRowId: (row) => row.id,
        storageKey: "appload.portal.quotes.columns",
    })

    const chips = activeFilters()

    return (
        <>
            <ListCard>
                <ListToolbar
                    table={table}
                    tabs={{ param: "status", items: statusTabs(stats), as: "menu" }}
                    filterCount={chips.length}
                    activeFilters={chips}
                    sort={{
                        defaultValue: DEFAULT_SORT,
                        defaultDir: DEFAULT_DIR,
                        options: QUOTE_SORTS.map((value) => ({ value, label: t(`sort.${value}`) })),
                    }}
                    filters={
                        <div className="flex flex-col gap-1">
                            <FilterToggle
                                label={t("filters.expiring")}
                                hint={t("filters.expiring-hint")}
                                param="expiring"
                                value="1"
                                count={stats.expiringSoon}
                            />
                        </div>
                    }
                />

                <div className={cn("flex min-h-0 flex-1 flex-col transition-opacity", isRefreshing && "opacity-60")}>
                    <DataTable
                        table={table}
                        sort={sort}
                        onSort={onSort}
                        onRowClick={onOpen}
                        selectable={false}
                        isFiltered={isFilteredQuotes(get)}
                        activeRowId={sheet.id}
                        empty={{
                            title: t("data.empty"),
                            description: t(`data.empty-description.${orgType}`),
                            filtered: t("data.no-results"),
                        }}
                    />
                </div>

                <ListFooter page={data.page} pageSize={data.pageSize} total={data.total} pageSizes={PAGE_SIZES} />
            </ListCard>

            <QuoteSheet
                orgType={orgType}
                allowance={session.allowance}
                organizationName={session.organization.name}
            />
        </>
    )
}
