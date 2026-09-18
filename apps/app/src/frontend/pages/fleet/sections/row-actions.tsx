"use client"

import { IconCopy, IconDotsVertical, IconExternalLink, IconPencil } from "@tabler/icons-react"

import { Button } from "@workspace/ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

/**
 * The kebab at the end of every row: open the profile, edit, copy an
 * identifier. Small on purpose — everything a change has consequences for
 * lives in the profile, where the reader can see what they are changing.
 *
 * The labels are passed in rather than read from a namespace, because the
 * fleet and drivers lists both use this and their copy differs.
 */
export function RowActions({
    labels,
    onOpen,
    onEdit,
    copy = [],
}: {
    labels: { menu: string; open: string; edit?: string }
    onOpen: () => void
    onEdit?: () => void
    copy?: { label: string; value: string }[]
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={labels.menu} data-no-row-click className="text-muted-foreground">
                    <IconDotsVertical className="size-4" stroke={1.5} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52" data-no-row-click>
                <DropdownMenuItem onSelect={onOpen}>
                    <IconExternalLink stroke={1.5} />
                    {labels.open}
                </DropdownMenuItem>
                {onEdit && labels.edit && (
                    <DropdownMenuItem onSelect={onEdit}>
                        <IconPencil stroke={1.5} />
                        {labels.edit}
                    </DropdownMenuItem>
                )}
                {copy.length > 0 && <DropdownMenuSeparator />}
                {copy.map((entry) => (
                    <DropdownMenuItem
                        key={entry.label}
                        onSelect={() => navigator.clipboard.writeText(entry.value).catch(() => undefined)}
                    >
                        <IconCopy stroke={1.5} />
                        {entry.label}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
