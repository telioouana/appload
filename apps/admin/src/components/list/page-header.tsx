"use client"

import { useState } from "react"
import { IconLayoutGrid, IconLayoutList, IconSearch, IconX } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Spinner } from "@workspace/ui/components/spinner"
import { Separator } from "@workspace/ui/components/separator"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@workspace/ui/components/input-group"

import { useIsMobile } from "@workspace/ui/hooks/use-mobile"

import { cn } from "@workspace/ui/lib/utils"

import { useListParams } from "@/components/list/use-list-params"

const VIEWS = [
    { value: "list", Icon: IconLayoutList, label: "list" },
    { value: "grid", Icon: IconLayoutGrid, label: "grid" },
] as const

export type SegmentedFilter = {
    /** URL param this strip writes */
    param: string
    /** Value written for the leftmost option; null clears the param */
    options: { value: string; label: string }[]
    active: string
}

/**
 * The whole top of a list page in one card, the same shape the orders pages
 * use: title and description on the left, then search, the view toggle and
 * the primary action on the right.
 *
 * Search is local state synced to the URL on a delay, so typing stays
 * responsive while the query key only changes once the user pauses. The view
 * toggle is hidden on phones, where the list layout's grid tracks cannot fit
 * and the data view forces cards anyway.
 *
 * The second row only exists for pages that pass a segmented filter — the
 * others are a single row.
 */
export function PageHeader({
    title,
    description,
    search,
    segmented,
    action,
}: {
    title: string
    description: string
    search: {
        placeholder: string
        /** Accessible name for the clear button; callers pass a translated string */
        clearLabel: string
    }
    segmented?: SegmentedFilter
    action?: React.ReactNode
}) {
    const t = useTranslations("Admin.partners.filters")
    const { get, set, sync, isPending } = useListParams()
    const isMobile = useIsMobile()

    const [query, setQuery] = useState(get("search") ?? "")

    const view = get("view") === "grid" ? "grid" : "list"

    const update = (value: string) => {
        setQuery(value)
        sync({ key: "search", value: value.trim() || null })
    }

    return (
        <Card className="min-h-fit gap-4 py-4">
            <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                    <CardTitle className="font-heading truncate text-3xl font-bold leading-normal">
                        {title}
                    </CardTitle>
                    <CardDescription>{description}</CardDescription>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:min-w-0 lg:flex-1 lg:justify-end">
                    {/* Grows into whatever the title leaves behind rather than
                        a fixed width — the fleet placeholder is the longest */}
                    <InputGroup className="sm:min-w-0 sm:flex-1 lg:max-w-md">
                        <InputGroupAddon>
                            {isPending ? <Spinner className="size-4" /> : <IconSearch className="size-4" stroke={1.5} />}
                        </InputGroupAddon>

                        <InputGroupInput
                            value={query}
                            placeholder={search.placeholder}
                            onChange={(event) => update(event.target.value)}
                        />

                        {query && (
                            <InputGroupAddon align="inline-end">
                                <InputGroupButton
                                    size="icon-xs"
                                    variant="ghost"
                                    aria-label={search.clearLabel}
                                    onClick={() => update("")}
                                >
                                    <IconX className="size-4" stroke={1.5} />
                                </InputGroupButton>
                            </InputGroupAddon>
                        )}
                    </InputGroup>

                    <div className="flex items-center gap-2">
                        {!isMobile && (
                            <Tabs
                                value={view}
                                onValueChange={(value) => set({ key: "view", value: value === "list" ? null : value })}
                            >
                                <TabsList className="bg-muted gap-1 p-1">
                                    {VIEWS.map(({ value, Icon, label }) => (
                                        <TabsTrigger
                                            key={value}
                                            value={value}
                                            aria-label={t(`view.${label}`)}
                                            title={t(`view.${label}`)}
                                            className={cn(
                                                "cursor-pointer rounded-md border-none px-2.5 py-1.5",
                                                "data-active:bg-background data-active:text-primary",
                                            )}
                                        >
                                            <Icon className="size-4" stroke={1.5} />
                                        </TabsTrigger>
                                    ))}
                                </TabsList>
                            </Tabs>
                        )}

                        {action}
                    </div>
                </div>
            </CardHeader>

            {segmented && (
                <CardContent className="flex flex-col gap-4">
                    <Separator />

                    <Tabs
                        // A column flex parent stretches its children, and a
                        // full-bleed track behind three pills reads as a bug
                        className="lg:w-fit"
                        value={segmented.active}
                        onValueChange={(value) => set({
                            key: segmented.param,
                            value: value === segmented.options[0]?.value ? null : value,
                        })}
                    >
                        {/* A light track with a raised pill for the active
                            option — the same treatment as the view toggle, so
                            the two controls on this card match */}
                        <TabsList className="bg-muted w-full justify-start gap-1 rounded-full p-1 lg:w-auto">
                            {segmented.options.map((option) => (
                                <TabsTrigger
                                    key={option.value}
                                    value={option.value}
                                    className={cn(
                                        "text-muted-foreground flex-none cursor-pointer whitespace-nowrap rounded-full border-none px-4 py-1.5 text-sm",
                                        "data-active:bg-background data-active:text-foreground data-active:shadow-sm",
                                    )}
                                >
                                    {option.label}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                </CardContent>
            )}
        </Card>
    )
}
