"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Spinner } from "@workspace/ui/components/spinner"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { useTRPC } from "@/backend/api/client"
import { movementErrorKey, type MovementErrorMessage } from "@/frontend/pages/movements/lib/errors"
import { useMovementMutations } from "@/frontend/pages/movements/hooks/use-movement-mutations"
import type { MovementDetail } from "@/frontend/pages/movements/types"

/** A transporter that is not on the portal is typed in rather than picked. */
const OFF_PORTAL = "__typed"

/** Mirrors NAME_MAX on the movement schema. */
const NAME_MAX = 120

/**
 * Changing who moves the load, on the same row — same reference number,
 * same address, same trail and costs. A trip the company can no longer run
 * goes to a partner (who then has to be placed and priced, from
 * procurement); an order taken back runs on its own trucks, and whatever was
 * agreed with the partner is dropped.
 */
export function ConvertDialog({ load, onClose }: { load: MovementDetail; onClose: () => void }) {
    const t = useTranslations("App.loads")
    const trpc = useTRPC()

    const { convert } = useMovementMutations()

    const toPartner = load.execution === "own-fleet"

    const { data: options } = useQuery({ ...trpc.movements.formOptions.queryOptions(), enabled: toPartner })
    const carriers = (options?.partners ?? []).filter((partner) => partner.type === "carrier")

    const [carrierOrgId, setCarrierOrgId] = useState<string>("")
    const [carrierName, setCarrierName] = useState("")
    const [error, setError] = useState<MovementErrorMessage | null>(null)

    const typed = carrierOrgId === OFF_PORTAL
    const ready = !toPartner || (typed ? carrierName.trim().length > 0 : carrierOrgId.length > 0)

    function submit() {
        setError(null)

        convert.mutate(
            {
                id: load.id,
                expectedVersion: load.version,
                to: toPartner ? "partner" : "own-fleet",
                ...(toPartner && (typed ? { carrierName: carrierName.trim() } : { carrierOrgId })),
            },
            {
                onSuccess: onClose,
                onError: (failure) => setError(movementErrorKey(failure)),
            },
        )
    }

    return (
        <Dialog open onOpenChange={(next) => { if (!next && !convert.isPending) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t(toPartner ? "convert.to-partner-title" : "convert.to-own-fleet-title")}</DialogTitle>
                    <DialogDescription>
                        {t(toPartner ? "convert.to-partner-description" : "convert.to-own-fleet-description", { ref: load.ref })}
                    </DialogDescription>
                </DialogHeader>

                {toPartner && (
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-2">
                            <Label>{t("convert.partner")}</Label>
                            <Select value={carrierOrgId} onValueChange={setCarrierOrgId} disabled={convert.isPending}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder={t("convert.partner-placeholder")} />
                                </SelectTrigger>
                                <SelectContent position="popper">
                                    {carriers.map((carrier) => (
                                        <SelectItem key={carrier.id} value={carrier.id}>
                                            {carrier.name}
                                        </SelectItem>
                                    ))}
                                    <SelectItem value={OFF_PORTAL}>{t("form.off-portal-partner")}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {typed && (
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="convert-name">{t("convert.partner-name")}</Label>
                                <Input
                                    id="convert-name"
                                    value={carrierName}
                                    maxLength={NAME_MAX}
                                    disabled={convert.isPending}
                                    onChange={(event) => setCarrierName(event.target.value)}
                                />
                            </div>
                        )}
                    </div>
                )}

                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                    </Alert>
                )}

                <DialogFooter>
                    <Button variant="outline" disabled={convert.isPending} onClick={onClose}>
                        {t("dialogs.back")}
                    </Button>
                    <Button disabled={convert.isPending || !ready} onClick={submit}>
                        {convert.isPending && <Spinner className="size-4" />}
                        {t("dialogs.confirm")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
