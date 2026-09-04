"use client"

import { useState } from "react"
import { IconAlertTriangle, IconCheck, IconCopy } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"

import { cn } from "@workspace/ui/lib/utils"

/** Initials for an avatar fallback: at most two letters, always uppercase. */
export function initials(value: string) {
    return value
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0]?.toUpperCase() ?? "")
        .join("") || "?"
}

/** Avatar, name and a muted line under it — the first cell of every row. */
export function IdentityCell({
    image,
    fallback,
    name,
    sub,
    size = "md",
}: {
    image?: string | null
    fallback: string
    name: string
    sub?: React.ReactNode
    size?: "sm" | "md" | "lg"
}) {
    return (
        <div className="flex min-w-0 items-center gap-2.5">
            <Avatar className={cn("shrink-0", size === "sm" && "size-7", size === "md" && "size-9", size === "lg" && "size-12")}>
                {image && <AvatarImage src={image} alt={name} />}
                <AvatarFallback className={cn("font-medium", size === "sm" ? "text-[10px]" : size === "lg" ? "text-sm" : "text-xs")}>
                    {fallback}
                </AvatarFallback>
            </Avatar>

            <div className="flex min-w-0 flex-col gap-0.5">
                <span className={cn("truncate font-medium", size === "lg" ? "text-base" : "text-[13px]")}>{name}</span>
                {sub && <span className="text-muted-foreground truncate text-xs">{sub}</span>}
            </div>
        </div>
    )
}

/** A primary line over a muted secondary line. */
export function StackCell({ primary, secondary }: { primary: React.ReactNode; secondary?: React.ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate">{primary}</span>
            {secondary !== undefined && secondary !== null && (
                <span className="text-muted-foreground truncate text-xs">{secondary}</span>
            )}
        </div>
    )
}

/** Tabular figures for numbers and identifiers. */
export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
    return <span className={cn("font-mono text-[12.5px] tabular-nums", className)}>{children}</span>
}

/** A registration plate, boxed the way the plate itself is. */
export function PlateChip({ plate }: { plate: string }) {
    return (
        <span className="bg-background inline-flex w-fit items-center rounded-lg border px-2 py-0.5 font-mono text-xs font-medium tracking-wide whitespace-nowrap">
            {plate}
        </span>
    )
}

/** Text with a copy button that appears on hover. */
export function CopyableText({ value, children, label }: { value: string; children?: React.ReactNode; label: string }) {
    const t = useTranslations("Admin.list")
    const [copied, setCopied] = useState(false)

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
        } catch {
            // Clipboard blocked: the text is still selectable
        }
    }

    return (
        <span className="group/copy inline-flex min-w-0 items-center gap-1">
            <span className="truncate">{children ?? value}</span>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        aria-label={label}
                        onClick={copy}
                        data-no-row-click
                        className="text-muted-foreground hover:text-foreground cursor-pointer opacity-0 transition-opacity group-hover/copy:opacity-100 focus-visible:opacity-100"
                    >
                        {copied ? <IconCheck className="size-3.5" stroke={2} /> : <IconCopy className="size-3.5" stroke={1.5} />}
                    </button>
                </TooltipTrigger>
                <TooltipContent>{copied ? t("copied") : label}</TooltipContent>
            </Tooltip>
        </span>
    )
}

/** "n/N" with a small bar, plus an optional warning line under it. */
export function ProgressCell({
    approved,
    required,
    hint,
    tone = "warn",
}: {
    approved: number
    required: number
    hint?: React.ReactNode
    tone?: "warn" | "danger"
}) {
    const complete = required > 0 && approved === required
    const width = required > 0 ? Math.round((approved / required) * 100) : 0

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
                <Mono className={cn(complete && "text-[var(--status-verified-text)]")}>
                    <span className="font-medium">{approved}</span>
                    <span className="text-muted-foreground">/{required}</span>
                </Mono>
                <span className="bg-muted h-1.5 w-14 overflow-hidden rounded-full">
                    <span
                        className={cn("block h-full rounded-full", complete ? "bg-[var(--status-verified-text)]" : "bg-primary")}
                        style={{ width: `${width}%` }}
                    />
                </span>
            </div>
            {hint && (
                <span className={cn(
                    "inline-flex items-center gap-1 text-xs",
                    tone === "danger" ? "text-[var(--status-rejected-text)]" : "text-[var(--status-expired-text)]",
                )}>
                    <IconAlertTriangle className="size-3" stroke={1.5} />
                    {hint}
                </span>
            )}
        </div>
    )
}

/** A muted dash for a value that does not apply. */
export function Dash() {
    return <span className="text-muted-foreground/60">—</span>
}
