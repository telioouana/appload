"use client"

import { IconArrowRight, IconCancel, IconCheck, IconCopy, IconDotsVertical, IconEdit, IconExternalLink, IconLayoutSidebarRightExpand } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { Link } from "@/i18n/navigation"

import { Button } from "@workspace/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { primaryOrderAction } from "@/frontend/pages/orders/lib/actions"
import type { OrderRow, OrderStatus } from "@/frontend/pages/orders/types"

export type RowCallbacks = {
    onOpen: (row: OrderRow) => void
    onConfirm: (row: OrderRow) => void
    onEdit: (row: OrderRow) => void
    /** Without a target the dialog opens on its status list */
    onTransition: (row: OrderRow, to?: OrderStatus) => void
}

const TERMINAL: OrderStatus[] = ["completed", "cancelled", "underbid"]

/**
 * The end of every order row: the single next step, shown on hover so a
 * scanning eye is not distracted by a column of arrows, and a kebab with
 * the rest. Everything here carries `data-no-row-click`, so none of it also
 * opens the sheet.
 */
export function OrderRowActions({ row, onOpen, onConfirm, onEdit, onTransition }: { row: OrderRow } & RowCallbacks) {
    const t = useTranslations("Admin.orders.list.actions")
    const tStatus = useTranslations("Admin.orders.header.filters.status.options")

    const primary = primaryOrderAction(row)
    const terminal = TERMINAL.includes(row.status)
    const primaryLabel = primary?.kind === "confirm" ? t("confirm") : primary ? tStatus(primary.to) : null

    return (
        <div className="flex items-center justify-end gap-0.5">
            {primary && primaryLabel && (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            data-no-row-click
                            aria-label={primaryLabel}
                            onClick={() => (primary.kind === "confirm" ? onConfirm(row) : onTransition(row, primary.to))}
                            className="text-primary opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=delayed-open]:opacity-100"
                        >
                            {primary.kind === "confirm" ? <IconCheck className="size-4" stroke={1.5} /> : <IconArrowRight className="size-4" stroke={1.5} />}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">{primaryLabel}</TooltipContent>
                </Tooltip>
            )}

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={t("menu")} data-no-row-click className="text-muted-foreground">
                        <IconDotsVertical className="size-4" stroke={1.5} />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52" data-no-row-click>
                    <DropdownMenuItem onSelect={() => onOpen(row)}>
                        <IconLayoutSidebarRightExpand stroke={1.5} />
                        {t("open")}
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                        <Link href={{ pathname: "/orders/details/[orderId]", params: { orderId: row.orderId } }}>
                            <IconExternalLink stroke={1.5} />
                            {t("full-page")}
                        </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onEdit(row)}>
                        <IconEdit stroke={1.5} />
                        {t("edit")}
                    </DropdownMenuItem>
                    {!terminal && (
                        <DropdownMenuItem onSelect={() => onTransition(row)}>
                            <IconArrowRight stroke={1.5} />
                            {t("change-status")}
                        </DropdownMenuItem>
                    )}
                    {!terminal && row.status !== "delivered" && (
                        <DropdownMenuItem variant="destructive" onSelect={() => onTransition(row, "cancelled")}>
                            <IconCancel stroke={1.5} />
                            {t("cancel")}
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => navigator.clipboard.writeText(row.orderId).catch(() => undefined)}>
                        <IconCopy stroke={1.5} />
                        {t("copy-id")}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}
