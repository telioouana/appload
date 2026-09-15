"use client"

import { useMemo, useState } from "react"
import {
    IconArrowDown,
    IconArrowUp,
    IconArrowsSort,
    IconBox,
    IconClockExclamation,
    IconDownload,
    IconRoute,
    IconSearchOff,
} from "@tabler/icons-react"

import { useFormatter, useNow, useTranslations } from "@workspace/i18n"
import { ORDER_STATUS } from "@workspace/db/types"

import { Button } from "@workspace/ui/components/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"

import { Scroller } from "@workspace/ui/customs/list/scroller"
import { Dash, PlateChip } from "@workspace/ui/customs/list/table-cells"
import { downloadCsv, stamp } from "@workspace/ui/lib/csv"
import { cn } from "@workspace/ui/lib/utils"

import { Link } from "@/i18n/navigation"
import { OrderStatusBadge } from "@/frontend/pages/orders/components/badges"
import { MapSearchInput } from "@/frontend/pages/map/components/map-search-input"
import { useMapTableFilters } from "@/frontend/pages/map/hooks/use-map-table-filters"
import { hoursSince, isStale, placeText } from "@/frontend/pages/map/lib/positions"
import { matchesEntity } from "@/frontend/pages/map/lib/search"
import type { MapEntity, MapEntityKind } from "@/frontend/pages/map/types"

// Radix Select cannot carry an empty value, so "any" travels as a sentinel
const ANY = "__any"

const KINDS: MapEntityKind[] = ["order", "load"]

type SortKey = "ref" | "last" | "hours"

type Sort = { key: SortKey; dir: "asc" | "desc" }

/** Newest ping first; movements that have never pinged sink to the bottom */
const seenAt = (entity: MapEntity) => entity.lastPosition?.recordedAt.getTime() ?? 0

/**
 * A filter as a small dropdown in the toolbar. The first entry clears the
 * param; the rest are whatever the rows currently hold, so a status nobody
 * is in never appears as a choice.
 */
function ToolbarSelect({
    label,
    value,
    options,
    onChange,
}: {
    label: string
    value: string | null
    options: { value: string; label: string }[]
    onChange: (value: string | null) => void
}) {
    const current = value !== null && options.some((option) => option.value === value) ? value : ANY

    return (
        <Select value={current} onValueChange={(next) => onChange(next === ANY ? null : next)}>
            <SelectTrigger size="sm" aria-label={label} className="min-w-36">
                <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-72">
                <SelectItem value={ANY}>{label}</SelectItem>
                {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

/**
 * The same movements as the pins, one row each, for the reader who wants to
 * scan or export rather than look: where each truck last was, as text, and
 * how long ago. Filters cut the rows here in the browser and live in the
 * URL; a truck silent for over twelve hours is written in red.
 */
export function MapTable({
    entities,
    query,
    onQueryChange,
    selected,
    onSelect,
    className,
}: {
    entities: MapEntity[]
    query: string
    onQueryChange: (value: string) => void
    selected: string | null
    onSelect: (ref: string) => void
    className?: string
}) {
    const t = useTranslations("App.map")
    const statuses = useTranslations("App.orders.status")
    const f = useFormatter()
    // Explicit now keeps relativeTime warning-free and ticks the labels over
    const now = useNow({ updateInterval: 60_000 })

    const { stale, status, kind, setFilter } = useMapTableFilters()

    const [sort, setSort] = useState<Sort>({ key: "last", dir: "desc" })

    // Only the statuses somebody is actually in, in the chain's own order
    const statusOptions = useMemo(
        () => ORDER_STATUS
            .filter((value) => entities.some((entity) => entity.status === value))
            .map((value) => ({ value, label: statuses(value) })),
        [entities, statuses],
    )

    const rows = useMemo(() => {
        const kept = entities.filter((entity) =>
            matchesEntity(entity, query)
            && (!stale || isStale(entity, now))
            && (status === null || entity.status === status)
            && (kind === null || entity.kind === kind))

        const compare: Record<SortKey, (a: MapEntity, b: MapEntity) => number> = {
            ref: (a, b) => a.ref.localeCompare(b.ref),
            last: (a, b) => seenAt(a) - seenAt(b),
            // Never pinged counts as the longest wait of all
            hours: (a, b) => (hoursSince(a, now) ?? Infinity) - (hoursSince(b, now) ?? Infinity),
        }

        const sign = sort.dir === "asc" ? 1 : -1

        return kept.sort((a, b) => sign * compare[sort.key](a, b) || a.ref.localeCompare(b.ref))
    }, [entities, query, stale, status, kind, now, sort])

    const isFiltered = Boolean(query) || stale || status !== null || kind !== null

    const toggleSort = (key: SortKey) =>
        setSort((current) => ({
            key,
            // A time column opens newest/longest first; the reference reads A–Z
            dir: current.key === key ? (current.dir === "asc" ? "desc" : "asc") : key === "ref" ? "asc" : "desc",
        }))

    const exportRows = () =>
        downloadCsv(
            `map-positions-${stamp()}.csv`,
            [
                t("table.columns.ref"), t("table.columns.status"), t("table.columns.counterparty"), t("table.columns.driver"),
                t("table.columns.plate"), t("table.columns.place"), t("table.columns.latitude"), t("table.columns.longitude"),
                t("table.columns.last-update"), t("table.columns.hours"), t("table.stale"),
            ],
            rows.map((entity) => [
                entity.ref,
                statuses(entity.status),
                entity.counterpartyName ?? "",
                entity.driverName ?? "",
                entity.truckPlate ?? "",
                placeText(entity) ?? "",
                entity.lastPosition?.lat ?? "",
                entity.lastPosition?.lng ?? "",
                entity.lastPosition?.recordedAt.toISOString() ?? "",
                hoursSince(entity, now) ?? "",
                isStale(entity, now) ? "yes" : "",
            ]),
        )

    // A plain render helper rather than a component, so the header buttons
    // are not remounted on every tick of `now`
    const sortHead = (column: SortKey, label: string, className?: string) => {
        const active = sort.key === column

        return (
            <TableHead className={cn("text-muted-foreground h-11 text-xs font-medium", className)}>
                <button
                    type="button"
                    onClick={() => toggleSort(column)}
                    className={cn(
                        "hover:text-foreground inline-flex cursor-pointer items-center gap-1 transition-colors",
                        active && "text-foreground",
                    )}
                >
                    {label}
                    {active
                        ? sort.dir === "desc"
                            ? <IconArrowDown className="size-3" stroke={2} />
                            : <IconArrowUp className="size-3" stroke={2} />
                        : <IconArrowsSort className="size-3 opacity-60" stroke={1.5} />}
                </button>
            </TableHead>
        )
    }

    return (
        <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
            <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
                <MapSearchInput query={query} onQueryChange={onQueryChange} className="w-full sm:w-72" />

                <ToolbarSelect
                    label={t("table.status")}
                    value={status}
                    options={statusOptions}
                    onChange={(value) => setFilter("status", value)}
                />

                <ToolbarSelect
                    label={t("table.kind")}
                    value={kind}
                    options={KINDS.map((value) => ({ value, label: t(`table.kinds.${value}`) }))}
                    onChange={(value) => setFilter("kind", value)}
                />

                <Button
                    size="sm"
                    variant={stale ? "default" : "outline"}
                    aria-pressed={stale}
                    onClick={() => setFilter("stale", stale ? null : "1")}
                >
                    <IconClockExclamation className="size-4" stroke={1.5} />
                    {t("table.stale-filter")}
                </Button>

                <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                    {isFiltered ? t("matches", { count: rows.length }) : t("count", { count: rows.length })}
                </span>

                <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={exportRows}>
                    <IconDownload className="size-4" stroke={1.5} />
                    {t("table.export")}
                </Button>
            </div>

            {rows.length === 0 ? (
                <Empty className="flex-1 border-none">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <IconSearchOff stroke={1.5} />
                        </EmptyMedia>
                        <EmptyTitle>{t("table.empty")}</EmptyTitle>
                        <EmptyDescription>{t("table.empty-description")}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <Scroller>
                    <Table className="min-w-[960px]">
                        {/* Opaque background: the rows scroll underneath this */}
                        <TableHeader className="bg-card sticky top-0 z-10 shadow-[inset_0_-1px_0_0_var(--border)]">
                            <TableRow className="bg-muted/40 hover:bg-muted/40">
                                {sortHead("ref", t("table.columns.ref"), "pl-4")}
                                <TableHead className="text-muted-foreground h-11 text-xs font-medium">{t("table.columns.status")}</TableHead>
                                <TableHead className="text-muted-foreground h-11 text-xs font-medium">{t("table.columns.counterparty")}</TableHead>
                                <TableHead className="text-muted-foreground h-11 text-xs font-medium">{t("table.columns.driver")}</TableHead>
                                <TableHead className="text-muted-foreground h-11 text-xs font-medium">{t("table.columns.plate")}</TableHead>
                                <TableHead className="text-muted-foreground h-11 text-xs font-medium">{t("table.columns.place")}</TableHead>
                                {sortHead("last", t("table.columns.last-update"))}
                                {sortHead("hours", t("table.columns.hours"), "pr-4 text-right")}
                            </TableRow>
                        </TableHeader>

                        <TableBody>
                            {rows.map((entity) => {
                                const isSelected = entity.ref === selected
                                const late = isStale(entity, now)
                                const hours = hoursSince(entity, now)
                                const position = entity.lastPosition
                                // An order and a load read alike otherwise; the
                                // mark says which page the reference leads to
                                const KindIcon = entity.kind === "load" ? IconRoute : IconBox

                                return (
                                    <TableRow
                                        key={entity.ref}
                                        aria-current={isSelected ? "true" : undefined}
                                        onClick={(event) => {
                                            // The reference is a link to the movement's own page; a click on it must not also open the row
                                            if (event.target instanceof Element && event.target.closest("a")) return
                                            onSelect(entity.ref)
                                        }}
                                        className={cn(
                                            "cursor-pointer",
                                            late && "bg-destructive/5 hover:bg-destructive/10",
                                            isSelected && "bg-muted/60",
                                        )}
                                    >
                                        <TableCell className="py-2 pl-4 text-[13px]">
                                            <Link href={entity.href} className="inline-flex items-center gap-1.5 font-medium hover:underline">
                                                <KindIcon className="text-muted-foreground size-3.5 shrink-0" stroke={1.5} />
                                                {entity.ref}
                                            </Link>
                                        </TableCell>
                                        <TableCell className="py-2">
                                            <OrderStatusBadge status={entity.status} className="px-1.5 py-0.5 text-xs" />
                                        </TableCell>
                                        <TableCell className="max-w-48 truncate py-2 text-[13px]">{entity.counterpartyName ?? <Dash />}</TableCell>
                                        <TableCell className="max-w-40 truncate py-2 text-[13px]">{entity.driverName ?? <Dash />}</TableCell>
                                        <TableCell className="py-2">{entity.truckPlate ? <PlateChip plate={entity.truckPlate} /> : <Dash />}</TableCell>
                                        <TableCell className="max-w-64 truncate py-2 text-[13px]" title={placeText(entity) ?? undefined}>
                                            {placeText(entity) ?? <Dash />}
                                        </TableCell>
                                        <TableCell className={cn("py-2 text-[13px] whitespace-nowrap", late && "text-destructive")} title={late ? t("table.stale") : undefined}>
                                            {position ? (
                                                <span className="flex flex-col gap-0.5">
                                                    <span>{f.relativeTime(position.recordedAt, now)}</span>
                                                    <span className={cn("text-xs", late ? "text-destructive/80" : "text-muted-foreground")}>
                                                        {f.dateTime(position.recordedAt, { dateStyle: "short", timeStyle: "short" })}
                                                    </span>
                                                </span>
                                            ) : t("table.no-position")}
                                        </TableCell>
                                        <TableCell className={cn("py-2 pr-4 text-right text-[13px] tabular-nums", late && "text-destructive")}>
                                            {hours ?? "—"}
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
