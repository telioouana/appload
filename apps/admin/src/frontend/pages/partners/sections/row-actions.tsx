"use client"

import { IconCopy, IconDotsVertical, IconExternalLink, IconFileCheck } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

/**
 * The kebab at the end of every row. Small on purpose — open, review, copy
 * an identifier. Anything that changes a partner's standing (risk, suspension,
 * edits) lives in the profile, where the reader can see what they are
 * changing.
 */
export function RowActions({
    onOpen,
    onReview,
    copy = [],
}: {
    onOpen: () => void
    onReview: () => void
    copy?: { label: string; value: string }[]
}) {
    const t = useTranslations("Admin.partners.actions")

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t("menu")} data-no-row-click className="text-muted-foreground">
                    <IconDotsVertical className="size-4" stroke={1.5} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52" data-no-row-click>
                <DropdownMenuItem onSelect={onOpen}>
                    <IconExternalLink stroke={1.5} />
                    {t("open")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onReview}>
                    <IconFileCheck stroke={1.5} />
                    {t("review")}
                </DropdownMenuItem>
                {copy.length > 0 && <DropdownMenuSeparator />}
                {copy.map((entry) => (
                    <DropdownMenuItem key={entry.label} onSelect={() => navigator.clipboard.writeText(entry.value).catch(() => undefined)}>
                        <IconCopy stroke={1.5} />
                        {entry.label}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
