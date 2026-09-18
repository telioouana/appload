"use client"

import { useState } from "react"
import { IconDotsVertical, IconExternalLink, IconLinkOff, IconUserMinus } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@workspace/ui/components/dropdown-menu"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@workspace/ui/components/alert-dialog"

import { usePartnerMutations } from "@/frontend/pages/partners/hooks/use-partner-mutations"
import type { PartnerRow } from "@/frontend/pages/partners/types"

/**
 * The kebab at the end of every row: open the profile, and the one action
 * that ends the relationship — removing an accepted connection, or taking
 * back a request nobody has answered. Both ask first: the other side sees
 * the result, and a mis-click is not undone by clicking again.
 */
export function PartnerRowActions({ row, onOpen }: { row: PartnerRow; onOpen: () => void }) {
    const t = useTranslations("App.partners.actions")
    const { remove, withdraw } = usePartnerMutations()

    const [confirming, setConfirming] = useState(false)

    const pendingOutgoing = row.status === "pending" && row.direction === "outgoing"
    const canEnd = row.status === "accepted" || pendingOutgoing
    const isWorking = remove.isPending || withdraw.isPending

    const end = () => {
        setConfirming(false)

        if (pendingOutgoing) {
            withdraw.mutate({ id: row.id })
            return
        }

        remove.mutate({ id: row.id })
    }

    return (
        <>
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

                    {canEnd && (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" disabled={isWorking} onSelect={() => setConfirming(true)}>
                                {pendingOutgoing ? <IconLinkOff stroke={1.5} /> : <IconUserMinus stroke={1.5} />}
                                {t(pendingOutgoing ? "withdraw" : "remove")}
                            </DropdownMenuItem>
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>

            <AlertDialog open={confirming} onOpenChange={setConfirming}>
                <AlertDialogContent data-no-row-click>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t(pendingOutgoing ? "withdraw-confirm.title" : "remove-confirm.title")}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t(pendingOutgoing ? "withdraw-confirm.description" : "remove-confirm.description", { name: row.partner.name })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    <AlertDialogFooter>
                        <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                        <AlertDialogAction onClick={end}>
                            {t(pendingOutgoing ? "withdraw" : "remove")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
