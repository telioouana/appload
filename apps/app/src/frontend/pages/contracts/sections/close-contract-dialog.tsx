"use client"

import { useTranslations } from "@workspace/i18n"

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"

import { useContractMutations } from "@/frontend/pages/contracts/hooks/use-contract-mutations"
import type { ContractDetail } from "@/frontend/pages/contracts/types"

/**
 * Closing a contract ends it where it stands: nothing more is filed under
 * it, whatever is left of the commitment. A failure is toasted by the
 * mutations hook.
 */
export function CloseContractDialog({
    contract,
    open,
    onOpenChange,
}: {
    contract: ContractDetail
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const t = useTranslations("App.contracts")
    const { transition } = useContractMutations()

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{t("detail.actions.close")}</AlertDialogTitle>
                    <AlertDialogDescription>{t("detail.actions.close-confirm")}</AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter>
                    <AlertDialogCancel>{t("form.cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                        disabled={transition.isPending}
                        onClick={() => transition.mutate({ id: contract.id, to: "closed", expectedVersion: contract.version })}
                    >
                        {t("detail.actions.close")}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
