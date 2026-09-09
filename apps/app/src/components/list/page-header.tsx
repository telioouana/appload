"use client"

import { useEffect, useRef, useState } from "react"
import { IconSearch, IconX, type Icon } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Kbd } from "@workspace/ui/components/kbd"
import { Spinner } from "@workspace/ui/components/spinner"
import { Command, CommandGroup, CommandItem, CommandList } from "@workspace/ui/components/command"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@workspace/ui/components/input-group"

import { cn } from "@workspace/ui/lib/utils"

import { useListParams, type Param } from "@/components/list/use-list-params"

/** Opens the global ⌘K palette from anywhere; the palette listens for it. */
export const COMMAND_EVENT = "appload:command"

export type SuggestionItem = {
    id: string
    label: string
    hint?: string
    Icon?: Icon
    /** The URL params the quick filter writes; the header adds the cleared search and page in the same write */
    params: Param[]
}

export type SuggestionGroup = { heading: string; items: SuggestionItem[] }

/**
 * The top of a list page: an eyebrow breadcrumb, the title with its record
 * count, a one-line description, then search and the primary action on the
 * right. No card around it — the table below is the surface, the header
 * just names it.
 *
 * Search is local state synced to the URL on a delay, so typing stays
 * responsive while the query key only changes once the user pauses. A new
 * search also drops the page, so a narrower result never opens on a page
 * that no longer exists. A page can hang quick filters under the box
 * (`search.suggestions`): matches the page computes from data it already
 * holds, offered as actions while the plain text search stays the default.
 */
export function PageHeader({
    eyebrow,
    title,
    count,
    description,
    search,
    actions,
    below,
    leading,
}: {
    eyebrow?: string[]
    title: string
    count?: number
    description?: string
    search?: {
        placeholder: string
        /** Accessible name for the clear button; callers pass a translated string */
        clearLabel: string
        suggestions?: {
            /** Characters typed before suggestions appear; two by default */
            minChars?: number
            groups: (query: string) => SuggestionGroup[]
            /** The first row, which keeps the text as a plain search */
            searchLabel: (query: string) => string
        }
    }
    actions?: React.ReactNode
    /** A second row under the title, e.g. the fleet's kind switch */
    below?: React.ReactNode
    /** Sits before the title column, e.g. a detail page's back button */
    leading?: React.ReactNode
}) {
    const t = useTranslations("App.list")
    const { get, set, sync, cancel, isPending } = useListParams()

    const [query, setQuery] = useState(get("search") ?? "")
    const [open, setOpen] = useState(false)
    const wrapperRef = useRef<HTMLDivElement>(null)

    const update = (value: string) => {
        setQuery(value)
        setOpen(true)
        sync([
            { key: "search", value: value.trim() || null },
            { key: "page", value: null },
        ])
    }

    const term = query.trim()
    const suggestions = search?.suggestions
    const groups = suggestions && term.length >= (suggestions.minChars ?? 2) ? suggestions.groups(term) : []
    const showList = open && suggestions !== undefined && term.length >= (suggestions.minChars ?? 2)

    // Outside click closes the list; Escape is handled on the wrapper
    useEffect(() => {
        if (!showList) return

        const onMouseDown = (event: MouseEvent) => {
            if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
        }

        document.addEventListener("mousedown", onMouseDown)
        return () => document.removeEventListener("mousedown", onMouseDown)
    }, [showList])

    const keepText = () => {
        // The debounced sync may still be pending; write the term now instead
        cancel()
        set([{ key: "search", value: term || null }, { key: "page", value: null }])
        setOpen(false)
    }

    const pick = (item: SuggestionItem) => {
        // One write: the quick filter, no text search, first page. The
        // pending sync of the typed text is dropped so it cannot undo this
        cancel()
        setQuery("")
        setOpen(false)
        set([...item.params, { key: "search", value: null }, { key: "page", value: null }])
    }

    const input = (
        <InputGroup className="sm:w-80">
            <InputGroupAddon>
                {isPending ? <Spinner className="size-4" /> : <IconSearch className="size-4" stroke={1.5} />}
            </InputGroupAddon>

            <InputGroupInput
                value={query}
                placeholder={search?.placeholder}
                onChange={(event) => update(event.target.value)}
                onFocus={() => setOpen(true)}
                role={suggestions ? "combobox" : undefined}
                aria-expanded={suggestions ? showList : undefined}
                aria-autocomplete={suggestions ? "list" : undefined}
            />

            <InputGroupAddon align="inline-end">
                {query ? (
                    <InputGroupButton
                        size="icon-xs"
                        variant="ghost"
                        aria-label={search?.clearLabel}
                        onClick={() => update("")}
                    >
                        <IconX className="size-4" stroke={1.5} />
                    </InputGroupButton>
                ) : (
                    <button
                        type="button"
                        aria-label={t("command")}
                        title={t("command")}
                        className="hidden cursor-pointer sm:inline-flex"
                        onClick={() => window.dispatchEvent(new CustomEvent(COMMAND_EVENT))}
                    >
                        <Kbd>⌘K</Kbd>
                    </button>
                )}
            </InputGroupAddon>
        </InputGroup>
    )

    return (
        <header className="flex flex-col gap-4 px-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
                {leading}

                <div className="flex min-w-0 flex-col gap-1">
                    {eyebrow && eyebrow.length > 0 && (
                        <nav aria-label={t("breadcrumb")} className="text-muted-foreground flex items-center gap-1.5 text-xs">
                            {eyebrow.map((crumb, index) => (
                                <span key={`${crumb}-${index}`} className="flex items-center gap-1.5">
                                    {index > 0 && <span aria-hidden>/</span>}
                                    <span className={index === eyebrow.length - 1 ? "text-foreground/70" : undefined}>{crumb}</span>
                                </span>
                            ))}
                        </nav>
                    )}

                    <div className="flex items-center gap-2.5">
                        <h1 className="font-heading truncate text-2xl font-semibold tracking-tight">{title}</h1>
                        {count !== undefined && (
                            <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums">
                                {count.toLocaleString()}
                            </span>
                        )}
                    </div>

                    {description && <p className="text-muted-foreground text-sm">{description}</p>}

                    {below}
                </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:shrink-0">
                {search && !suggestions && input}

                {search && suggestions && (
                    // cmdk gives the plain input arrow keys and Enter as long
                    // as it sits inside the Command root; the list is only
                    // mounted while it has something to offer
                    <div
                        ref={wrapperRef}
                        className="relative"
                        onKeyDown={(event) => { if (event.key === "Escape") setOpen(false) }}
                    >
                        <Command shouldFilter={false} className="h-auto overflow-visible rounded-none bg-transparent p-0 text-foreground">
                            {input}

                            {showList && (
                                <CommandList
                                    aria-label={t("suggestions")}
                                    className={cn(
                                        "bg-popover text-popover-foreground ring-foreground/5 absolute top-full right-0 left-0 z-30 mt-2 max-h-80 rounded-2xl p-1 shadow-lg ring-1",
                                    )}
                                >
                                    <CommandGroup>
                                        <CommandItem value="__search" onSelect={keepText} className="gap-3">
                                            <IconSearch className="size-4" stroke={1.5} />
                                            <span className="truncate">{suggestions.searchLabel(term)}</span>
                                        </CommandItem>
                                    </CommandGroup>

                                    {groups.filter((group) => group.items.length > 0).map((group) => (
                                        <CommandGroup key={group.heading} heading={group.heading}>
                                            {group.items.map((item) => (
                                                <CommandItem key={item.id} value={item.id} onSelect={() => pick(item)} className="gap-3">
                                                    {item.Icon && <item.Icon className="text-muted-foreground size-4 shrink-0" stroke={1.5} />}
                                                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                                    {item.hint && <span className="text-muted-foreground shrink-0 text-xs">{item.hint}</span>}
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    ))}
                                </CommandList>
                            )}
                        </Command>
                    </div>
                )}

                {actions && <div className="flex items-center gap-2">{actions}</div>}
            </div>
        </header>
    )
}
