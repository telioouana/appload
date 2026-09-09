"use client"

import type { Table as TableInstance } from "@tanstack/react-table"
import { IconArrowsSort, IconChevronDown, IconCircleDot, IconDownload, IconFilter, IconLayoutColumns, IconX } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { cn } from "@workspace/ui/lib/utils"

import { useListParams } from "@/components/list/use-list-params"

export type StatusTab = { value: string; label: string; count: number }

export type SortOption = { value: string; label: string }

export type ActiveFilter = { key: string; label: string; value: string }

/**
 * The strip across the top of the table card.
 *
 * Left: the status slice, each choice carrying its count — the primary way
 * to cut the list, as a tab strip or, where a page has too many statuses to
 * line up, a menu like the sort one. Right: the page's own filters in a
 * popover, the sort menu, the column chooser and export. Whatever filters
 * are active show as chips underneath, so a narrowed list is never a
 * mystery.
 */
export function ListToolbar<T>({
    table,
    tabs,
    filters,
    filterCount = 0,
    activeFilters,
    sort,
    onExport,
    isExporting = false,
}: {
    table: TableInstance<T>
    /** `as` picks the presentation: a tab strip by default, a menu where the statuses are many */
    tabs: { param: string; items: StatusTab[]; as?: "tabs" | "menu" }
    /** The filter popover's body; the page decides what it holds */
    filters?: React.ReactNode
    /** How many filters are active, shown on the Filters button */
    filterCount?: number
    activeFilters?: ActiveFilter[]
    /** `defaultDir` is what an absent `dir` param means; ascending unless the page says otherwise */
    sort: { options: SortOption[]; defaultValue: string; defaultDir?: "asc" | "desc" }
    onExport?: () => void
    isExporting?: boolean
}) {
    const t = useTranslations("App.list")
    const { get, set } = useListParams()

    const activeTab = get(tabs.param) ?? tabs.items[0]?.value ?? ""
    const current = tabs.items.find((tab) => tab.value === activeTab)
    const sortValue = get("sort") ?? sort.defaultValue
    const defaultDir = sort.defaultDir ?? "asc"
    const rawDir = get("dir")
    const dir = rawDir === "asc" || rawDir === "desc" ? rawDir : defaultDir

    const selectTab = (value: string) =>
        set([
            { key: tabs.param, value: value === tabs.items[0]?.value ? null : value },
            { key: "page", value: null },
        ])

    const clearFilter = (key: string) => set([{ key, value: null }, { key: "page", value: null }])

    const clearAll = () =>
        set([...(activeFilters ?? []).map(({ key }) => ({ key, value: null })), { key: "page", value: null }])

    return (
        <div className="flex flex-col">
            <div className="flex flex-col gap-2 border-b px-3 md:flex-row md:items-center md:justify-between">
                {tabs.as === "menu" ? (
                    <div className="flex min-w-0 items-center py-2">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" aria-label={t("status")}>
                                    <IconCircleDot className="size-4" stroke={1.5} />
                                    <span className="truncate">{current?.label ?? t("status")}</span>
                                    {current && (
                                        <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-px text-[11px] leading-4 tabular-nums">
                                            {current.count.toLocaleString()}
                                        </span>
                                    )}
                                    <IconChevronDown className="size-3.5" stroke={1.5} />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="container-snap max-h-[calc((var(--radix-dropdown-menu-content-available-height)-8px)/2)] w-60 overflow-y-auto">
                                <DropdownMenuLabel>{t("status")}</DropdownMenuLabel>
                                <DropdownMenuRadioGroup value={activeTab} onValueChange={selectTab}>
                                    {tabs.items.map((tab) => (
                                        <DropdownMenuRadioItem key={tab.value} value={tab.value}>
                                            <span className="truncate">{tab.label}</span>
                                            <span className="text-muted-foreground ml-auto tabular-nums">{tab.count.toLocaleString()}</span>
                                        </DropdownMenuRadioItem>
                                    ))}
                                </DropdownMenuRadioGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                ) : (
                    <div role="tablist" className="container-snap -mb-px flex min-w-0 gap-1 overflow-x-auto md:gap-4">
                        {tabs.items.map((tab) => {
                            const active = tab.value === activeTab

                            return (
                                <button
                                    key={tab.value}
                                    type="button"
                                    role="tab"
                                    aria-selected={active}
                                    // A long strip (every order status) scrolls; the
                                    // active tab pulls itself into view on mount
                                    ref={active ? (node) => node?.scrollIntoView({ inline: "nearest", block: "nearest" }) : undefined}
                                    onClick={() => selectTab(tab.value)}
                                    className={cn(
                                        "text-muted-foreground hover:text-foreground flex h-12 shrink-0 cursor-pointer items-center gap-1.5 border-b-2 border-transparent px-1 text-sm whitespace-nowrap transition-colors",
                                        active && "border-primary text-foreground font-medium",
                                    )}
                                >
                                    {tab.label}
                                    <span className={cn(
                                        "bg-muted text-muted-foreground rounded-full px-1.5 py-px text-[11px] leading-4 tabular-nums",
                                        active && "bg-primary/12 text-primary",
                                    )}>
                                        {tab.count.toLocaleString()}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                )}

                <div className="flex items-center gap-2 pb-2 md:pb-0">
                    {filters && (
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm">
                                    <IconFilter className="size-4" stroke={1.5} />
                                    {t("filters")}
                                    {filterCount > 0 && (
                                        <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-[11px] leading-4 tabular-nums">
                                            {filterCount}
                                        </span>
                                    )}
                                </Button>
                            </PopoverTrigger>
                            {/* Half the room Radix reports below the trigger, so the
                                popover never swallows the page; the body scrolls inside it */}
                            <PopoverContent
                                align="end"
                                collisionPadding={12}
                                className="container-snap w-80 max-h-[calc((var(--radix-popover-content-available-height)-8px)/2)] overflow-y-auto"
                            >
                                {filters}
                            </PopoverContent>
                        </Popover>
                    )}

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                                <IconArrowsSort className="size-4" stroke={1.5} />
                                <span className="hidden sm:inline">
                                    {sort.options.find((option) => option.value === sortValue)?.label ?? t("sort")}
                                </span>
                                <IconChevronDown className="size-3.5" stroke={1.5} />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuLabel>{t("sort-by")}</DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                                value={sortValue}
                                onValueChange={(value) => set([
                                    { key: "sort", value: value === sort.defaultValue ? null : value },
                                    { key: "page", value: null },
                                ])}
                            >
                                {sort.options.map((option) => (
                                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                                        {option.label}
                                    </DropdownMenuRadioItem>
                                ))}
                            </DropdownMenuRadioGroup>
                            <DropdownMenuSeparator />
                            <DropdownMenuRadioGroup
                                value={dir}
                                onValueChange={(value) => set([
                                    { key: "dir", value: value === defaultDir ? null : value },
                                    { key: "page", value: null },
                                ])}
                            >
                                <DropdownMenuRadioItem value="asc">{t("ascending")}</DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="desc">{t("descending")}</DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Emphatically not hidden on a phone: the table is the only
                        presentation now, and dropping columns is the one way to
                        make nine of them fit a narrow screen */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon-sm" aria-label={t("columns")} title={t("columns")}>
                                <IconLayoutColumns className="size-4" stroke={1.5} />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuLabel>{t("columns")}</DropdownMenuLabel>
                            {table.getAllLeafColumns()
                                .filter((column) => column.getCanHide())
                                .map((column) => (
                                    <DropdownMenuCheckboxItem
                                        key={column.id}
                                        checked={column.getIsVisible()}
                                        onCheckedChange={(value) => column.toggleVisibility(value === true)}
                                        onSelect={(event) => event.preventDefault()}
                                    >
                                        {column.columnDef.meta?.label ?? column.id}
                                    </DropdownMenuCheckboxItem>
                                ))}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {onExport && (
                        <Button
                            variant="outline"
                            size="icon-sm"
                            aria-label={t("export")}
                            title={t("export")}
                            disabled={isExporting}
                            onClick={onExport}
                        >
                            {isExporting ? <Spinner className="size-4" /> : <IconDownload className="size-4" stroke={1.5} />}
                        </Button>
                    )}
                </div>
            </div>

            {activeFilters && activeFilters.length > 0 && (
                <div className="bg-muted/35 flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
                    {activeFilters.map((filter) => (
                        <span
                            key={filter.key}
                            className="bg-background inline-flex items-center gap-1.5 rounded-full border py-1 pr-1.5 pl-2.5"
                        >
                            <span className="text-muted-foreground">{filter.label}</span>
                            <span className="font-medium">{filter.value}</span>
                            <button
                                type="button"
                                aria-label={t("remove-filter", { filter: filter.label })}
                                onClick={() => clearFilter(filter.key)}
                                className="text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                                <IconX className="size-3" stroke={2} />
                            </button>
                        </span>
                    ))}

                    <button type="button" onClick={clearAll} className="text-muted-foreground hover:text-foreground cursor-pointer">
                        {t("clear-all")}
                    </button>
                </div>
            )}
        </div>
    )
}
