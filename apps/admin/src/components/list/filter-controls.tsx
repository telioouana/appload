"use client"

import { IconCheck } from "@tabler/icons-react"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"

import { cn } from "@workspace/ui/lib/utils"

import { useListParams } from "@/components/list/use-list-params"

// Radix Select cannot carry an empty value, so "any" travels as a sentinel
const ANY = "__any"

/**
 * One URL param as a labelled dropdown inside the Filters popover. The
 * first entry clears the param; every change drops the page so a narrower
 * result never opens on a page that no longer exists.
 */
export function FilterChoice({
    label,
    param,
    options,
    anyLabel,
}: {
    label: string
    param: string
    options: { value: string; label: string; count?: number }[]
    /** The entry that clears the param, shown first */
    anyLabel: string
}) {
    const { get, set } = useListParams()
    const current = get(param)
    const value = current !== null && options.some((option) => option.value === current) ? current : ANY

    const choose = (next: string) =>
        set([{ key: param, value: next === ANY ? null : next }, { key: "page", value: null }])

    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <span id={`filter-${param}`} className="text-muted-foreground text-xs font-medium">{label}</span>
            <Select value={value} onValueChange={choose}>
                <SelectTrigger size="sm" className="w-full" aria-labelledby={`filter-${param}`}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-72">
                    <SelectItem value={ANY}>{anyLabel}</SelectItem>
                    {options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            <span className="flex w-full min-w-0 items-center justify-between gap-3">
                                <span className="truncate">{option.label}</span>
                                {option.count !== undefined && (
                                    <span className="text-muted-foreground text-xs tabular-nums">{option.count.toLocaleString()}</span>
                                )}
                            </span>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    )
}

/** A boolean filter: on when the param carries `value`; `count` says how many rows it would open. */
export function FilterToggle({ label, param, value, hint, count }: { label: string; param: string; value: string; hint?: string; count?: number }) {
    const { get, set } = useListParams()
    const active = get(param) === value

    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={active}
            onClick={() => set([{ key: param, value: active ? null : value }, { key: "page", value: null }])}
            className="hover:bg-muted/60 flex cursor-pointer items-center gap-3 rounded-2xl px-2 py-1.5 text-left text-sm transition-colors"
        >
            <span className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                active ? "bg-primary border-primary text-primary-foreground" : "border-ring bg-input/50",
            )}>
                {active && <IconCheck className="size-3" stroke={2.5} />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
                <span>{label}</span>
                {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
            </span>
            {count !== undefined && (
                <span className={cn(
                    "bg-muted text-muted-foreground shrink-0 rounded-full px-1.5 py-px text-[11px] leading-4 tabular-nums",
                    active && "bg-primary/12 text-primary",
                )}>
                    {count.toLocaleString()}
                </span>
            )}
        </button>
    )
}
