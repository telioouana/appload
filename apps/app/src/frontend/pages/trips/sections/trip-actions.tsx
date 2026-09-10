"use client"

import { useState } from "react"
import { IconBan, IconFlagCheck, IconMapPinShare, IconTruckDelivery } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import type { TrackingAllowance } from "@workspace/domain/subscription"

import { PlanDialog, planBlock, planRefusal, type PlanReason } from "@/components/plan-dialog"
import { useTripMutations } from "@/frontend/pages/trips/hooks/use-trip-mutations"
import type { TripDetail } from "@/frontend/pages/trips/types"

/**
 * Everything the owner can do to a trip, in one row of buttons — shared by
 * the list panel and the detail page so the two can never offer different
 * moves. What is on offer comes from the server's own `permissions`, not
 * from a rule restated here.
 *
 * Putting a trip on the road is what a plan pays for, so the button consults
 * the allowance before it opens anything and answers a server refusal with
 * the same dialog: the refusal arrives before the work rather than after it.
 */
export function TripActions({
    trip,
    allowance,
    organizationName,
    onClosed,
}: {
    trip: TripDetail
    allowance: TrackingAllowance
    organizationName: string
    /** Called once the trip has been delivered or cancelled, so a panel can close */
    onClosed?: () => void
}) {
    const t = useTranslations("App.trips.actions")

    const { setStatus, requestLocation } = useTripMutations()

    const [confirming, setConfirming] = useState<"delivered" | "cancelled" | null>(null)
    const [planReason, setPlanReason] = useState<PlanReason | null>(null)

    const { permissions } = trip
    const isPending = setStatus.isPending || requestLocation.isPending
    const blocked = planBlock(allowance)

    const start = () => {
        if (blocked) {
            setPlanReason(blocked)
            return
        }

        setStatus.mutate(
            { id: trip.id, to: "in-transit" },
            { onError: (error) => { const reason = planRefusal(error); if (reason) setPlanReason(reason) } },
        )
    }

    const confirm = () => {
        if (!confirming) return

        setStatus.mutate({ id: trip.id, to: confirming }, {
            onSuccess: () => { setConfirming(null); onClosed?.() },
        })
    }

    if (!permissions.isMine) return null

    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                {permissions.canStart && (
                    <Button size="sm" disabled={isPending} onClick={start}>
                        {setStatus.isPending ? <Spinner className="size-4" /> : <IconTruckDelivery className="size-4" stroke={1.5} />}
                        {t("start")}
                    </Button>
                )}

                {permissions.canRequestLocation && (
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => requestLocation.mutate({ id: trip.id })}
                    >
                        {requestLocation.isPending ? <Spinner className="size-4" /> : <IconMapPinShare className="size-4" stroke={1.5} />}
                        {t("request-location")}
                    </Button>
                )}

                {permissions.canDeliver && (
                    <Button size="sm" variant="outline" disabled={isPending} onClick={() => setConfirming("delivered")}>
                        <IconFlagCheck className="size-4" stroke={1.5} />
                        {t("deliver")}
                    </Button>
                )}

                {permissions.canCancel && (
                    <Button size="sm" variant="outline" disabled={isPending} onClick={() => setConfirming("cancelled")}>
                        <IconBan className="size-4" stroke={1.5} />
                        {t("cancel")}
                    </Button>
                )}
            </div>

            <Dialog open={confirming !== null} onOpenChange={(next) => { if (!next) setConfirming(null) }}>
                <DialogContent className="sm:max-w-md">
                    {confirming && (
                        <>
                            <DialogHeader>
                                <DialogTitle>{t(`confirm.${confirming}.title`)}</DialogTitle>
                                <DialogDescription>
                                    {t(`confirm.${confirming}.description`, { ref: trip.ref })}
                                </DialogDescription>
                            </DialogHeader>

                            <DialogFooter>
                                <Button variant="outline" disabled={setStatus.isPending} onClick={() => setConfirming(null)}>
                                    {t("confirm.back")}
                                </Button>
                                <Button
                                    variant={confirming === "cancelled" ? "destructive" : "default"}
                                    disabled={setStatus.isPending}
                                    onClick={confirm}
                                >
                                    {setStatus.isPending && <Spinner className="size-4" />}
                                    {t(`confirm.${confirming}.confirm`)}
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {planReason && (
                <PlanDialog
                    reason={planReason}
                    allowance={allowance}
                    organizationName={organizationName}
                    onClose={() => setPlanReason(null)}
                />
            )}
        </>
    )
}
