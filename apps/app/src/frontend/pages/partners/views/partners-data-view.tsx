"use client"

import { useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { useIsFetching, useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { ListCard } from "@workspace/ui/customs/list/list-card"
import { ListFooter } from "@workspace/ui/customs/list/list-footer"
import { DataTable, useDataTable } from "@workspace/ui/customs/list/data-table"
import { useListParams } from "@workspace/ui/hooks/use-list-params"
import { useEntitySheet } from "@workspace/ui/hooks/use-entity-sheet"
import { usePartnerColumns } from "@/frontend/pages/partners/columns/partner-columns"
import { RequestsList } from "@/frontend/pages/partners/sections/requests-list"
import { PartnerProfileSheet } from "@/frontend/pages/partners/views/partner-profile-sheet"
import {
    isFilteredList,
    PAGE_SIZES,
    partnersListInput,
    type PartnerListKind,
    type PartnerRow,
} from "@/frontend/pages/partners/types"

const DEFAULT_SORT = "partner"

/**
 * The list card. Which of its two shapes it takes comes from the kind: the
 * connected partners are a table, and the requests are cards with the
 * buttons that decide them. Both read the same paged query, so the tiles,
 * the pills and the footer always agree.
 */
export function PartnersDataView({ kind }: { kind: PartnerListKind }) {
    const t = useTranslations("App.partners")
    const trpc = useTRPC()

    const searchParams = useSearchParams()
    const get = useCallback((key: string) => searchParams.get(key), [searchParams])
    const { set } = useListParams()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const orgType = session.organization.type

    const input = partnersListInput(kind, get)
    const { data } = useSuspenseQuery(trpc.partners.list.queryOptions(input))
    const isRefreshing = useIsFetching({ queryKey: trpc.partners.list.pathKey() }) > 0

    const { id: openId, open } = useEntitySheet()
    const onOpen = useCallback((row: PartnerRow) => open(row.id), [open])

    const sort = { key: get("sort") ?? DEFAULT_SORT, dir: get("dir") === "desc" ? "desc" as const : "asc" as const }

    const onSort = useCallback((key: string, dir: "asc" | "desc") =>
        set([
            { key: "sort", value: key === DEFAULT_SORT ? null : key },
            { key: "dir", value: dir === "asc" ? null : dir },
            { key: "page", value: null },
        ]), [set])

    const columns = usePartnerColumns({ orgType, onOpen })
    const table = useDataTable({
        columns,
        data: data.items,
        getRowId: (row) => row.id,
        storageKey: "appload.portal.partners.columns",
    })

    return (
        <>
            <ListCard>
                <div className={cn("flex min-h-0 flex-1 flex-col transition-opacity", isRefreshing && "opacity-60")}>
                    {kind === "requests" ? (
                        <RequestsList items={data.items} orgType={orgType} onOpen={onOpen} />
                    ) : (
                        <DataTable
                            table={table}
                            sort={sort}
                            onSort={onSort}
                            onRowClick={onOpen}
                            selectable={false}
                            isFiltered={isFilteredList(get)}
                            activeRowId={openId}
                            empty={{
                                title: t("data.empty"),
                                // A carrier's transporters are the ones it subcontracts, which asks for other words
                                description: kind === "clients" ? t("data.empty-clients") : t(`data.empty-transporters.${orgType}`),
                                filtered: t("data.no-results"),
                            }}
                        />
                    )}
                </div>

                <ListFooter page={data.page} pageSize={data.pageSize} total={data.total} pageSizes={PAGE_SIZES} />
            </ListCard>

            <PartnerProfileSheet orgType={orgType} />
        </>
    )
}
