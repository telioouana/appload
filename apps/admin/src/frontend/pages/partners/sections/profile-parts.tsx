"use client"

import { IconCopy, IconMapPin } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Mono } from "@workspace/ui/customs/list/table-cells"
import { MissingField, type MissingFieldKind } from "@/frontend/pages/partners/sections/missing-field"
import { WhatsappMark } from "@/frontend/pages/partners/sections/whatsapp-mark"
import type { WhatsappStatus } from "@/frontend/pages/partners/types"

import { cn } from "@workspace/ui/lib/utils"

/** A bounded block on the profile's overview: a small title, then rows. */
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
                {aside && <div className="text-muted-foreground text-xs">{aside}</div>}
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

/** A big number with a caption, four to a row. */
export function Stat({ value, label }: { value: React.ReactNode; label: string }) {
    return (
        <div className="flex flex-col gap-0.5">
            <span className="text-xl font-semibold tracking-tight tabular-nums">{value}</span>
            <span className="text-muted-foreground text-xs">{label}</span>
        </div>
    )
}

/** "n of N fields" with a bar and, underneath, a dashed "Add …" for each gap. */
export function Completeness({
    filled,
    total,
    missing,
    labels,
    onSave,
}: {
    filled: number
    total: number
    missing: string[]
    /** Field key → human label */
    labels: Record<string, string>
    /** Field key → save handler, when the gap can be filled inline */
    onSave?: Partial<Record<string, { kind: MissingFieldKind; save: (value: string) => Promise<unknown> }>>
}) {
    const t = useTranslations("Admin.partners.profile")
    const width = total > 0 ? Math.round((filled / total) * 100) : 0
    const complete = filled === total

    return (
        <ProfileCard title={t("completeness")} aside={t("fields-filled", { filled, total })}>
            <div className="bg-muted h-2 overflow-hidden rounded-full">
                <div
                    className={cn("h-full rounded-full transition-[width]", complete ? "bg-[var(--status-verified-text)]" : "bg-primary")}
                    style={{ width: `${width}%` }}
                />
            </div>

            {missing.length > 0 && (
                <ul className="flex flex-wrap items-center gap-2">
                    {missing.map((key) => {
                        const inline = onSave?.[key]

                        return (
                            <li key={key} className="flex items-center gap-1.5 text-xs">
                                {inline
                                    ? <MissingField kind={inline.kind} label={t("add", { field: labels[key] ?? key })} onSave={inline.save} />
                                    : <span className="text-muted-foreground border-border rounded-full border border-dashed px-2 py-0.5">{labels[key] ?? key}</span>}
                            </li>
                        )
                    })}
                </ul>
            )}
        </ProfileCard>
    )
}

/**
 * A phone number with a copy shortcut, and the WhatsApp mark when our chat
 * history knows the number (drivers only — companies have no history).
 */
export function PhoneValue({ value, whatsapp = "unknown" }: { value: string; whatsapp?: WhatsappStatus }) {
    const t = useTranslations("Admin.partners.actions")

    return (
        <span className="inline-flex items-center gap-1.5">
            <Mono>{value}</Mono>
            <WhatsappMark status={whatsapp} phone={value} />
            <CopyButton value={value} label={t("copy-phone")} />
        </span>
    )
}

export function CopyButton({ value, label }: { value: string; label: string }) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={() => navigator.clipboard.writeText(value).catch(() => undefined)}
            className="text-muted-foreground hover:text-foreground cursor-pointer"
        >
            <IconCopy className="size-3.5" stroke={1.5} />
        </button>
    )
}

/** An address with a map link, wrapping under its label on narrow panels. */
export function AddressValue({ address }: { address: { address: string; placeId?: string } | null }) {
    const t = useTranslations("Admin.partners.profile")

    if (!address) return <span className="text-muted-foreground">{t("none")}</span>

    const href = address.placeId
        ? `https://www.google.com/maps/place/?q=place_id:${address.placeId}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.address)}`

    return (
        <span className="inline-flex min-w-0 items-start gap-1.5 text-right">
            <span className="min-w-0 text-wrap">{address.address}</span>
            <a href={href} target="_blank" rel="noreferrer" aria-label={t("open-map")} title={t("open-map")} className="text-muted-foreground hover:text-foreground mt-0.5 shrink-0">
                <IconMapPin className="size-3.5" stroke={1.5} />
            </a>
        </span>
    )
}

export function DateValue({ value }: { value: Date | string | null | undefined }) {
    const f = useFormatter()
    const t = useTranslations("Admin.partners.profile")

    if (!value) return <span className="text-muted-foreground">{t("none")}</span>

    const date = typeof value === "string" ? new Date(`${value}T00:00:00`) : value

    return <span>{f.dateTime(date, { dateStyle: "medium" })}</span>
}
