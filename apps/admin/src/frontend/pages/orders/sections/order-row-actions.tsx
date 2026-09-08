"use client"

import { IconArrowRight, IconCancel, IconCheck, IconCopy, IconDotsVertical, IconEdit, IconExternalLink, IconLayoutSidebarRightExpand, IconPlus } from "@tabler/icons-react"

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
    /** Books the prospect by accepting one of its offers */
    onAccept: (row: OrderRow) => void
    /** Opens the row's offers so the first one can be registered */
    onAddOffer: (row: OrderRow) => void
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
export function OrderRowActions({ row, onOpen, onAccept, onAddOffer, onEdit, onTransition }: { row: OrderRow } & RowCallbacks) {
    const t = useTranslations("Admin.orders.list.actions")
    const tStatus = useTranslations("Admin.orders.header.filters.status.options")

    // The row carries its pending-offer count, so a prospect's step names
    // itself: accept one of them, or add the first
    const primary = primaryOrderAction(row, null, row.offerCount)
    const terminal = TERMINAL.includes(row.status)
    const primaryLabel =
        primary === null ? null
            : primary.kind === "accept-offer" ? t("accept-offer")
                : primary.kind === "add-offer" ? t("add-offer")
                    : tStatus(primary.to)

    const runPrimary = () => {
        if (!primary) return
        if (primary.kind === "accept-offer") onAccept(row)
        else if (primary.kind === "add-offer") onAddOffer(row)
        else onTransition(row, primary.to)
    }

    const primaryIcon =
        primary?.kind === "accept-offer" ? <IconCheck className="size-4" stroke={1.5} />
            : primary?.kind === "add-offer" ? <IconPlus className="size-4" stroke={1.5} />
                : <IconArrowRight className="size-4" stroke={1.5} />

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
                            onClick={runPrimary}
                            className="text-primary opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=delayed-open]:opacity-100"
                        >
                            {primaryIcon}
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
                    {primary && primary.kind !== "transition" && primaryLabel && (
                        <DropdownMenuItem onSelect={runPrimary}>
                            {primary.kind === "accept-offer" ? <IconCheck stroke={1.5} /> : <IconPlus stroke={1.5} />}
                            {primaryLabel}
                        </DropdownMenuItem>
                    )}
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
