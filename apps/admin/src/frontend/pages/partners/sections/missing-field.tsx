"use client"

import { useState } from "react"
import { IconPlus } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Input } from "@workspace/ui/components/input"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"

import { cn } from "@workspace/ui/lib/utils"

import { domainErrorCode } from "@/lib/trpc-error"

export type MissingFieldKind = "nuit" | "email" | "phone" | "passport"

const EDIT_ERROR_CODES = ["DUPLICATE_NUIT", "DUPLICATE_EMAIL", "DUPLICATE_PHONE", "NOT_ALLOWED", "NOT_FOUND", "UNKNOWN"] as const

type EditErrorCode = (typeof EDIT_ERROR_CODES)[number]

/** Digits only for a NUIT; E.164 for a phone, assuming Mozambique when no code is typed. */
function normalize(kind: MissingFieldKind, raw: string): string | null {
    const value = raw.trim()

    if (kind === "nuit") {
        const digits = value.replace(/\D/g, "")
        return /^\d{9}$/.test(digits) ? digits : null
    }

    if (kind === "phone") {
        const digits = value.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "")
        const withCode = digits.startsWith("+") ? digits : digits.startsWith("00") ? `+${digits.slice(2)}` : `+258${digits.replace(/^0/, "")}`
        return /^\+[1-9]\d{7,14}$/.test(withCode) ? withCode : null
    }

    if (kind === "email") {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value.toLowerCase() : null
    }

    return value.length >= 3 ? value.toUpperCase() : null
}

/**
 * A dashed "Add NUIT" in place of a placeholder value. Opens a one-field
 * popover and saves through whatever mutation the row hands in, so fixing
 * the data happens where the gap is seen — no form, no detail page.
 */
export function MissingField({
    kind,
    label,
    onSave,
    className,
}: {
    kind: MissingFieldKind
    /** The dashed trigger's text, e.g. "Add NUIT" */
    label: string
    onSave: (value: string) => Promise<unknown>
    className?: string
}) {
    const t = useTranslations("Admin.partners.missing")

    const [open, setOpen] = useState(false)
    const [value, setValue] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [isSaving, setSaving] = useState(false)

    const submit = async (event: React.FormEvent) => {
        event.preventDefault()
        if (isSaving) return

        const normalized = normalize(kind, value)
        if (!normalized) {
            setError(t(`invalid.${kind}`))
            return
        }

        setSaving(true)
        setError(null)

        try {
            await onSave(normalized)
            setOpen(false)
            setValue("")
        } catch (caught) {
            setError(t(`errors.${domainErrorCode<EditErrorCode>(caught, EDIT_ERROR_CODES, "UNKNOWN")}`))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setError(null) }}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    data-no-row-click
                    className={cn(
                        "text-primary border-primary/45 hover:bg-primary/5 inline-flex w-fit cursor-pointer items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors",
                        className,
                    )}
                >
                    <IconPlus className="size-3" stroke={2} />
                    {label}
                </button>
            </PopoverTrigger>

            <PopoverContent
                align="start"
                className="w-72 gap-3"
                data-no-row-click
                onClick={(event) => event.stopPropagation()}
                // Disabling the focused Save button while saving moves focus
                // to the body, which a popover would otherwise read as
                // "focus left, dismiss" — and the error would never be seen
                onFocusOutside={(event) => event.preventDefault()}
            >
                <form onSubmit={submit} className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                        <label className="text-sm font-medium" htmlFor={`missing-${kind}`}>{label}</label>
                        <span className="text-muted-foreground text-xs">{t(`hint.${kind}`)}</span>
                    </div>

                    <Input
                        id={`missing-${kind}`}
                        autoFocus
                        value={value}
                        placeholder={t(`placeholder.${kind}`)}
                        onChange={(event) => { setValue(event.target.value); setError(null) }}
                        aria-invalid={error ? true : undefined}
                        inputMode={kind === "nuit" ? "numeric" : kind === "phone" ? "tel" : kind === "email" ? "email" : "text"}
                    />

                    {error && <p className="text-destructive text-xs">{error}</p>}

                    <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                            {t("cancel")}
                        </Button>
                        <Button type="submit" size="sm" disabled={!value.trim()} aria-busy={isSaving}>
                            {isSaving && <Spinner className="size-3.5" />}
                            {t("save")}
                        </Button>
                    </div>
                </form>
            </PopoverContent>
        </Popover>
    )
}
