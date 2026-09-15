"use client"

import { useMemo, useState } from "react"
import { IconArrowDown, IconArrowUp, IconArrowsSort, IconDownload, IconSearch, IconSearchOff, IconX } from "@tabler/icons-react"

import { useFormatter, useNow, useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@workspace/ui/components/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"
import { Toggle } from "@workspace/ui/components/toggle"
import { Dash, Mono, PlateChip, StackCell } from "@workspace/ui/customs/list/table-cells"
import { Scroller } from "@workspace/ui/customs/list/scroller"
import { useListParams } from "@workspace/ui/hooks/use-list-params"
import { downloadCsv, stamp } from "@workspace/ui/lib/csv"

import { cn } from "@workspace/ui/lib/utils"

import { useOrderSheet } from "@/frontend/pages/orders/hooks/use-order-sheet"
import { OrderStatusBadge } from "@/frontend/pages/orders/sections/order-item-shared"
import {
    DEFAULT_TABLE_SORT,
    filterRows,
    hoursSince,
    isStale,
    placeText,
    sortRows,
    type TableSort,
    type TableSortKey,
} from "@/frontend/pages/map/lib/table"
import type { MapOrder } from "@/frontend/pages/map/types"

// Radix Select cannot carry an empty value, so "all" travels as a sentinel
const ANY = "__any"

/** A header that sorts, with the same arrows the list tables use. */
function SortHeader({ label, sortKey, sort, onSort }: { label: string; sortKey: TableSortKey; sort: TableSort; onSort: (key: TableSortKey) => void }) {
    const active = sort.key === sortKey

    return (
        <button
            type="button"
            onClick={() => onSort(sortKey)}
            className={cn("hover:text-foreground inline-flex cursor-pointer items-center gap-1 transition-colors", active && "text-foreground")}
        >
            {label}
            {active
                ? sort.dir === "desc"
                    ? <IconArrowDown className="size-3" stroke={2} />
                    : <IconArrowUp className="size-3" stroke={2} />
                : <IconArrowsSort className="size-3 opacity-60" stroke={1.5} />}
        </button>
    )
}

/**
 * The same loads as the pins, one row each with its latest position as
 * text, for the operator who wants to scan, filter and hand the list to
 * someone as a spreadsheet. The filters live in the URL so a narrowed view
 * can be pasted into a chat; the sort is local, it is presentation only.
 */
export function MapTable({
    orders,
    query,
    onQueryChange,
}: {
    orders: MapOrder[]
    query: string
    onQueryChange: (value: string) => void
}) {
    const t = useTranslations("Admin.map")
    const s = useTranslations("Admin.orders.header.filters.status.options")
    const f = useFormatter()
    const now = useNow({ updateInterval: 60_000 })

    const { get, shallow } = useListParams()
    const sheet = useOrderSheet()

    // Typing stays local; the URL gets the trimmed text (same as the map's list)
    const [text, setText] = useState(query)
    const [lastQuery, setLastQuery] = useState(query)

    if (query !== lastQuery) {
        setLastQuery(query)
        if (text.trim() !== query) setText(query)
    }

    const [sort, setSort] = useState<TableSort>(DEFAULT_TABLE_SORT)

    const stale = get("stale") === "1"
    const status = get("status")
    const carrier = get("carrier")

    // The choices are what is on the road right now, not every value the
    // system knows: a filter that can only empty the table is no filter
    const statuses = useMemo(() => [...new Set(orders.map((order) => order.status))].sort(), [orders])
    const carriers = useMemo(
        () => [...new Set(orders.flatMap((order) => order.carrierName ? [order.carrierName] : []))].sort((a, b) => a.localeCompare(b)),
        [orders],
    )

    const rows = useMemo(
        () => sortRows(filterRows(orders, { query, stale, status, carrier }, now), sort, now),
        [orders, query, stale, status, carrier, sort, now],
    )

    const isFiltered = Boolean(query || stale || status || carrier)

    const update = (value: string) => {
        setText(value)
        onQueryChange(value)
    }

    const toggleSort = (key: TableSortKey) =>
        setSort((current) => ({ key, dir: current.key === key && current.dir === "desc" ? "asc" : "desc" }))

    const onExport = () => {
        downloadCsv(
            `map-positions-${stamp()}.csv`,
            [
                t("table.columns.order"), t("table.columns.status"), t("table.columns.shipper"), t("table.columns.carrier"),
                t("table.columns.driver"), t("table.columns.plate"), t("table.columns.place"), t("table.columns.latitude"),
                t("table.columns.longitude"), t("table.columns.updated"), t("table.columns.hours"), t("table.columns.stale"),
            ],
            rows.map((order) => [
                order.orderId, order.status, order.shipperName, order.carrierName, order.driverName, order.truckPlate,
                placeText(order), order.lastLocation?.lat, order.lastLocation?.lng, order.lastLocation?.recordedAt.toISOString(),
                hoursSince(order, now), isStale(order, now) ? "yes" : "",
            ]),
        )
    }

    const headClass = "text-muted-foreground h-11 text-xs font-medium"

    return (
        <div className="bg-card relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border">
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
                <InputGroup className="w-full sm:w-72">
                    <InputGroupAddon>
                        <IconSearch className="size-4" stroke={1.5} />
                    </InputGroupAddon>

                    <InputGroupInput
                        value={text}
                        placeholder={t("search")}
                        onChange={(event) => update(event.target.value)}
                    />

                    {text && (
                        <InputGroupAddon align="inline-end">
                            <InputGroupButton size="icon-xs" variant="ghost" aria-label={t("clear-search")} onClick={() => update("")}>
                                <IconX className="size-4" stroke={1.5} />
                            </InputGroupButton>
                        </InputGroupAddon>
                    )}
                </InputGroup>

                <Toggle
                    size="sm"
                    variant="outline"
                    pressed={stale}
                    onPressedChange={(pressed) => shallow({ key: "stale", value: pressed ? "1" : null })}
                    className="data-[state=on]:border-destructive/40 data-[state=on]:bg-destructive/10 data-[state=on]:text-destructive"
                >
                    {t("table.stale-filter")}
                </Toggle>

                <Select
                    value={status && statuses.includes(status as MapOrder["status"]) ? status : ANY}
                    onValueChange={(value) => shallow({ key: "status", value: value === ANY ? null : value })}
                >
                    <SelectTrigger size="sm" className="w-44" aria-label={t("table.status")}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                        <SelectItem value={ANY}>{t("table.status")}: {t("table.any")}</SelectItem>
                        {statuses.map((value) => (
                            <SelectItem key={value} value={value}>{s(value)}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={carrier && carriers.includes(carrier) ? carrier : ANY}
                    onValueChange={(value) => shallow({ key: "carrier", value: value === ANY ? null : value })}
                >
                    <SelectTrigger size="sm" className="w-52" aria-label={t("table.carrier")}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" className="max-h-72">
                        <SelectItem value={ANY}>{t("table.carrier")}: {t("table.any")}</SelectItem>
                        {carriers.map((name) => (
                            <SelectItem key={name} value={name}>{name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <span className="text-muted-foreground ml-auto text-xs">
                    {isFiltered ? t("matches", { count: rows.length }) : t("count", { count: rows.length })}
                </span>

                <Button variant="outline" size="sm" disabled={rows.length === 0} onClick={onExport}>
                    <IconDownload className="size-4" stroke={1.5} />
                    {t("table.export")}
                </Button>
            </div>

            {rows.length === 0 ? (
                <Empty className="flex-1 border-none py-16">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <IconSearchOff stroke={1.5} />
                        </EmptyMedia>
                        <EmptyTitle>{isFiltered ? t("table.empty") : t("empty.title")}</EmptyTitle>
                        <EmptyDescription>{isFiltered ? t("table.empty-description") : t("empty.description")}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <Scroller>
                    <Table className="min-w-[960px]">
                        <TableHeader className="bg-card sticky top-0 z-10 shadow-[inset_0_-1px_0_0_var(--border)]">
                            <TableRow className="bg-muted/40 hover:bg-muted/40">
                                <TableHead className={cn(headClass, "pl-4")}>
                                    <SortHeader label={t("table.columns.order")} sortKey="order" sort={sort} onSort={toggleSort} />
                                </TableHead>
                                <TableHead className={headClass}>{t("table.columns.status")}</TableHead>
                                <TableHead className={headClass}>{t("table.columns.shipper")}</TableHead>
                                <TableHead className={headClass}>{t("table.columns.carrier")}</TableHead>
                                <TableHead className={headClass}>{t("table.columns.driver")}</TableHead>
                                <TableHead className={headClass}>{t("table.columns.plate")}</TableHead>
                                <TableHead className={headClass}>{t("table.columns.place")}</TableHead>
                                <TableHead className={headClass}>
                                    <SortHeader label={t("table.columns.updated")} sortKey="updated" sort={sort} onSort={toggleSort} />
                                </TableHead>
                                <TableHead className={cn(headClass, "pr-4 text-right")}>
                                    <SortHeader label={t("table.columns.hours")} sortKey="hours" sort={sort} onSort={toggleSort} />
                                </TableHead>
                            </TableRow>
                        </TableHeader>

                        <TableBody>
                            {rows.map((order) => {
                                const location = order.lastLocation
                                const late = isStale(order, now)
                                const hours = hoursSince(order, now)
                                const active = sheet.id === order.orderId

                                return (
                                    <TableRow
                                        key={order.orderId}
                                        aria-current={active ? "true" : undefined}
                                        onClick={() => sheet.open(order.orderId)}
                                        className={cn(
                                            "cursor-pointer text-[13px]",
                                            late && "bg-destructive/5 hover:bg-destructive/10",
                                            active && "bg-muted/60",
                                        )}
                                    >
                                        <TableCell className="pl-4">
                                            <Mono className="font-medium">{order.orderId}</Mono>
                                        </TableCell>
                                        <TableCell>
                                            <OrderStatusBadge status={order.status} className="px-1.5 py-0.5 text-xs" />
                                        </TableCell>
                                        <TableCell className="max-w-48 truncate">{order.shipperName}</TableCell>
                                        <TableCell className="max-w-48 truncate">{order.carrierName ?? <Dash />}</TableCell>
                                        <TableCell className="max-w-40 truncate">{order.driverName ?? <Dash />}</TableCell>
                                        <TableCell>{order.truckPlate ? <PlateChip plate={order.truckPlate} /> : <Dash />}</TableCell>
                                        <TableCell className="max-w-64 truncate whitespace-normal" title={placeText(order) ?? undefined}>
                                            {placeText(order) ?? <Dash />}
                                        </TableCell>
                                        <TableCell className={cn(late && "text-destructive")} title={late ? t("table.stale") : undefined}>
                                            {location ? (
                                                <StackCell
                                                    primary={f.relativeTime(location.recordedAt, now)}
                                                    secondary={(
                                                        <span className={cn(late && "text-destructive/80")}>
                                                            {f.dateTime(location.recordedAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                                                        </span>
                                                    )}
                                                />
                                            ) : t("table.no-position")}
                                        </TableCell>
                                        <TableCell className={cn("pr-4 text-right tabular-nums", late && "text-destructive")}>
                                            {hours ?? <Dash />}
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </Scroller>
            )}
        </div>
    )
}
