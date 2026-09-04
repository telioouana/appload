"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
    flexRender,
    getCoreRowModel,
    useReactTable,
    type ColumnDef,
    type RowData,
    type RowSelectionState,
    type Table as TableInstance,
    type VisibilityState,
} from "@tanstack/react-table"
import { IconArrowDown, IconArrowUp, IconArrowsSort, IconSearchOff } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Checkbox } from "@workspace/ui/components/checkbox"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"

import { cn } from "@workspace/ui/lib/utils"

import { Scroller } from "@/components/list/scroller"
import { useListParams } from "@/components/list/use-list-params"

declare module "@tanstack/react-table" {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface ColumnMeta<TData extends RowData, TValue> {
        /** Header text; also the column's name in the Columns menu */
        label: string
        /** The URL `sort` value this header writes; omit for an unsortable column */
        sortKey?: string
        className?: string
        headerClassName?: string
        align?: "left" | "right"
    }
}

export type SortState = { key: string | undefined; dir: "asc" | "desc" }

const readVisibility = (storageKey: string): VisibilityState => {
    if (typeof window === "undefined") return {}
    try {
        const raw = window.localStorage.getItem(storageKey)
        return raw ? (JSON.parse(raw) as VisibilityState) : {}
    } catch {
        return {}
    }
}

/** The URL key the ticked rows live under */
const SELECTION_PARAM = "sel"

/** The tick column is rendered by hand, so its `w-10` is not in `getTotalSize()` */
const SELECT_COLUMN_WIDTH = 40

const readSelection = (value: string | null): RowSelectionState =>
    Object.fromEntries((value ?? "").split(",").filter(Boolean).map((id) => [id, true]))

/** Sorted, so the same set of ticks always produces the same URL */
const writeSelection = (state: RowSelectionState): string =>
    Object.keys(state).filter((id) => state[id]).sort().join(",")

/**
 * One TanStack table per list page. The server does the sorting and the
 * paging, so the instance only owns what is purely presentational: which
 * columns are visible (remembered per page in localStorage) and which rows
 * are ticked (kept in the URL, so a selection survives a refresh and can be
 * sent to someone else).
 */
export function useDataTable<T>({
    columns,
    data,
    getRowId,
    storageKey,
}: {
    columns: ColumnDef<T, unknown>[]
    data: T[]
    getRowId: (row: T) => string
    /** localStorage key the column visibility is remembered under */
    storageKey: string
}) {
    const searchParams = useSearchParams()
    const { shallow } = useListParams()

    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

    // Unlike localStorage the URL is readable on the server, so the ticks of
    // a shared link are already on in the very first render
    const selected = searchParams.get(SELECTION_PARAM)
    const [rowSelection, setRowSelection] = useState<RowSelectionState>(() => readSelection(selected))
    const ticked = writeSelection(rowSelection)

    // Read after mount so the server and first client render agree
    useEffect(() => {
        setColumnVisibility(readVisibility(storageKey))
    }, [storageKey])

    useEffect(() => {
        try {
            window.localStorage.setItem(storageKey, JSON.stringify(columnVisibility))
        } catch {
            // Private mode or a full store: the preference is a convenience
        }
    }, [storageKey, columnVisibility])

    // The URL follows the ticks. Written shallowly: which rows are ticked
    // changes nothing the server would send back, and a checkbox that
    // refetched the list on every click would be miserable.
    useEffect(() => {
        if (ticked !== (selected ?? "")) shallow({ key: SELECTION_PARAM, value: ticked || null })
    }, [ticked, selected, shallow])

    // ...and the ticks follow the URL, so the back button and a pasted link
    // both land where they should. Both effects no-op once the two agree.
    useEffect(() => {
        setRowSelection((current) => (writeSelection(current) === (selected ?? "") ? current : readSelection(selected)))
    }, [selected])

    // Selection is by id, so a page change never carries ticks across
    const memoColumns = useMemo(() => columns, [columns])

    return useReactTable({
        data,
        columns: memoColumns,
        getRowId,
        state: { columnVisibility, rowSelection },
        onColumnVisibilityChange: setColumnVisibility,
        onRowSelectionChange: setRowSelection,
        enableRowSelection: true,
        manualSorting: true,
        manualPagination: true,
        getCoreRowModel: getCoreRowModel(),
    })
}

/** Clicks on controls inside a row must not also open the row. */
const isInteractive = (target: EventTarget | null) =>
    target instanceof Element && Boolean(target.closest("button, a, input, select, textarea, [role=checkbox], [role=menuitem], [data-no-row-click]"))

/**
 * The table itself. Renders the visible columns with a sticky header,
 * sortable headers that write to the URL, a checkbox column when selection
 * is on, and an empty state that distinguishes "nothing yet" from
 * "nothing matched". Every page feeds it from a suspense query, so it
 * never sees a pending state and owns no loading branch.
 */
export function DataTable<T>({
    table,
    sort,
    onSort,
    onRowClick,
    selectable = true,
    isFiltered,
    empty,
    activeRowId,
}: {
    table: TableInstance<T>
    sort?: SortState
    onSort?: (key: string, dir: "asc" | "desc") => void
    onRowClick?: (row: T) => void
    selectable?: boolean
    isFiltered: boolean
    empty: { title: string; description: string; filtered: string; action?: React.ReactNode }
    /** The row whose profile is open, tinted so the reader keeps their place */
    activeRowId?: string | null
}) {
    const t = useTranslations("Admin.list")
    const rows = table.getRowModel().rows

    if (rows.length === 0) {
        return (
            <Scroller>
                <Empty className="border-none py-16">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <IconSearchOff stroke={1.5} />
                        </EmptyMedia>
                        <EmptyTitle>{isFiltered ? empty.filtered : empty.title}</EmptyTitle>
                        <EmptyDescription>{isFiltered ? t("empty.adjust") : empty.description}</EmptyDescription>
                    </EmptyHeader>
                    {empty.action}
                </Empty>
            </Scroller>
        )
    }

    const toggleSort = (key: string) => {
        if (!onSort) return
        const next = sort?.key === key && sort.dir === "asc" ? "desc" : "asc"
        onSort(key, next)
    }

    // `table-fixed` alone would squeeze every column into the viewport, so a
    // phone got nine unreadable slivers instead of a table it can scroll. The
    // floor is what the visible columns actually asked for, plus the tick box,
    // so hiding columns in the Columns menu genuinely narrows the table.
    const minWidth = table.getTotalSize() + (selectable ? SELECT_COLUMN_WIDTH : 0)

    return (
        <Scroller>
        <Table className="table-fixed" style={{ minWidth }}>
            {/* Opaque background: the rows scroll underneath this */}
            <TableHeader className="bg-card sticky top-0 z-10 shadow-[inset_0_-1px_0_0_var(--border)]">
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                    {selectable && (
                        <TableHead className="w-10 pl-4">
                            <Checkbox
                                aria-label={t("select-all")}
                                checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
                                onCheckedChange={(value) => table.toggleAllPageRowsSelected(value === true)}
                            />
                        </TableHead>
                    )}

                    {table.getHeaderGroups().map((group) =>
                        group.headers.map((header) => {
                            const meta = header.column.columnDef.meta
                            const sortKey = meta?.sortKey
                            const active = sortKey !== undefined && sort?.key === sortKey

                            return (
                                <TableHead
                                    key={header.id}
                                    style={{ width: header.getSize() }}
                                    className={cn(
                                        "text-muted-foreground h-11 text-xs font-medium",
                                        meta?.align === "right" && "text-right",
                                        meta?.headerClassName,
                                    )}
                                >
                                    {sortKey ? (
                                        <button
                                            type="button"
                                            onClick={() => toggleSort(sortKey)}
                                            className={cn(
                                                "hover:text-foreground inline-flex cursor-pointer items-center gap-1 transition-colors",
                                                active && "text-foreground",
                                            )}
                                        >
                                            {flexRender(header.column.columnDef.header, header.getContext())}
                                            {active
                                                ? sort?.dir === "desc"
                                                    ? <IconArrowDown className="size-3" stroke={2} />
                                                    : <IconArrowUp className="size-3" stroke={2} />
                                                : <IconArrowsSort className="size-3 opacity-60" stroke={1.5} />}
                                        </button>
                                    ) : (
                                        flexRender(header.column.columnDef.header, header.getContext())
                                    )}
                                </TableHead>
                            )
                        }),
                    )}
                </TableRow>
            </TableHeader>

            <TableBody>
                {rows.map((row) => (
                    <TableRow
                        key={row.id}
                        data-state={row.getIsSelected() ? "selected" : undefined}
                        aria-current={activeRowId === row.id ? "true" : undefined}
                        onClick={(event) => {
                            if (onRowClick && !isInteractive(event.target)) onRowClick(row.original)
                        }}
                        className={cn(
                            "group/row",
                            onRowClick && "cursor-pointer",
                            row.getIsSelected() && "bg-primary/5 hover:bg-primary/8",
                            activeRowId === row.id && "bg-muted/60",
                        )}
                    >
                        {selectable && (
                            <TableCell className="pl-4">
                                <Checkbox
                                    aria-label={t("select-row")}
                                    checked={row.getIsSelected()}
                                    onCheckedChange={(value) => row.toggleSelected(value === true)}
                                />
                            </TableCell>
                        )}

                        {row.getVisibleCells().map((cell) => {
                            const meta = cell.column.columnDef.meta

                            return (
                                <TableCell
                                    key={cell.id}
                                    className={cn(
                                        "h-15 py-2 text-[13px] whitespace-normal",
                                        meta?.align === "right" && "text-right",
                                        meta?.className,
                                    )}
                                >
                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </TableCell>
                            )
                        })}
                    </TableRow>
                ))}
            </TableBody>
        </Table>
        </Scroller>
    )
}
