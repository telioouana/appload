"use client"

import type { Table as TableInstance } from "@tanstack/react-table"
import { IconX } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

/**
 * The floating pill that appears once rows are ticked. Dark on purpose: it
 * sits over the table and has to read as a different layer. Actions are
 * passed in as buttons so each page decides what a selection can do.
 */
export function BulkBar<T>({ table, children }: { table: TableInstance<T>; children?: React.ReactNode }) {
    const t = useTranslations("App.list")
    const selected = table.getSelectedRowModel().rows.length

    if (selected === 0) return null

    return (
        <div
            role="toolbar"
            aria-label={t("selected", { count: selected })}
            className="bg-foreground text-background absolute bottom-16 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full py-1.5 pr-2 pl-4 text-[13px] shadow-xl"
        >
            <span className="mr-2 font-medium tabular-nums">{t("selected", { count: selected })}</span>

            {children}

            <button
                type="button"
                aria-label={t("clear-selection")}
                onClick={() => table.resetRowSelection()}
                className="hover:bg-background/15 ml-1 flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors"
            >
                <IconX className="size-4" stroke={1.5} />
            </button>
        </div>
    )
}

/** A button styled for the bulk bar's dark surface. */
export function BulkAction({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className="hover:bg-background/15 cursor-pointer rounded-full px-2.5 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
            {children}
        </button>
    )
}
