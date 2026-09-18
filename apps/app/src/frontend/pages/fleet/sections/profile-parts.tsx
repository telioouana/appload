"use client"

import { IconX } from "@tabler/icons-react"

import { useFormatter } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"

import { cn } from "@workspace/ui/lib/utils"

/** A bounded block on a profile panel: a small title, then rows. */
export function ProfileCard({
    title,
    aside,
    children,
    className,
}: {
    title: string
    aside?: React.ReactNode
    children: React.ReactNode
    className?: string
}) {
    return (
        <section className={cn("ring-foreground/5 flex flex-col gap-3 rounded-2xl p-4 ring-1", className)}>
            <header className="flex items-center justify-between gap-3">
                <h3 className="text-[13px] font-medium">{title}</h3>
                {aside}
            </header>
            {children}
        </section>
    )
}

/** Label on the left, value on the right. */
export function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-4 text-[13px]">
            <dt className="text-muted-foreground shrink-0">{label}</dt>
            <dd className="flex min-w-0 items-center justify-end gap-1.5 text-right">{children}</dd>
        </div>
    )
}

/** The head of a profile panel: identity, badges, actions and the close button. */
export function ProfileHeader({
    image,
    fallback,
    name,
    subtitle,
    badges,
    actions,
    closeLabel,
    onClose,
}: {
    image?: string | null
    fallback: React.ReactNode
    name: React.ReactNode
    subtitle?: React.ReactNode
    badges?: React.ReactNode
    actions?: React.ReactNode
    closeLabel: string
    onClose: () => void
}) {
    return (
        <div className="flex items-start gap-3.5">
            <Avatar className="size-12 shrink-0">
                {image && <AvatarImage src={image} alt={typeof name === "string" ? name : ""} />}
                <AvatarFallback className="text-sm font-medium">{fallback}</AvatarFallback>
            </Avatar>

            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <h2 className="font-heading truncate text-lg font-semibold tracking-tight">{name}</h2>
                {subtitle && <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-[13px]">{subtitle}</div>}
                {badges && <div className="flex flex-wrap items-center gap-1.5">{badges}</div>}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
                {actions}
                <Button variant="ghost" size="icon" onClick={onClose} aria-label={closeLabel} className="bg-secondary">
                    <IconX className="size-4" stroke={1.5} />
                </Button>
            </div>
        </div>
    )
}

/** The frame under the header: a scrolling body the panels fill with cards. */
export function ProfileBody({ children }: { children: React.ReactNode }) {
    return <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 md:px-6">{children}</div>
}

export function ProfileSkeleton() {
    return (
        <div className="flex flex-col gap-4 p-6">
            <div className="flex items-center gap-3">
                <Skeleton className="size-12 rounded-full" />
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-5 w-44 rounded-md" />
                    <Skeleton className="h-4 w-32 rounded-md" />
                </div>
            </div>
            {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-36 w-full rounded-2xl" />
            ))}
        </div>
    )
}

/**
 * A date the portal renders the same way everywhere: the calendar day, in the
 * reader's locale, never a raw timestamp.
 */
export function DateValue({ value, fallback }: { value: Date | string | null | undefined; fallback: string }) {
    const f = useFormatter()

    if (!value) return <span className="text-muted-foreground">{fallback}</span>

    const date = typeof value === "string" ? new Date(`${value}T00:00:00`) : value

    return <span>{f.dateTime(date, { dateStyle: "medium" })}</span>
}
