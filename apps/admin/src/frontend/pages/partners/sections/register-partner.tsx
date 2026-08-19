"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { useQueryClient } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { useTRPC } from "@/backend/api/client"
import { OrganizationInput } from "@/components/inputs/organization"
import { RegisterDriverDialog } from "@/frontend/pages/order/dialog/register-driver"
import { RegisterVehicleDialog } from "@/frontend/pages/order/dialog/register-vehicle"
import { RegisterOrganizationDialog } from "@/frontend/pages/order/dialog/register-organization"
import type { VehicleKind } from "@/frontend/pages/partners/types"

export type RegisterTarget =
    | { kind: "organization"; type: "shipper" | "carrier" }
    | { kind: "driver" }
    | { kind: "vehicle"; vehicle: VehicleKind }

/**
 * Registration launched from a partner page rather than from the order form.
 *
 * Drivers and vehicles belong to a carrier, and outside the order form there
 * is no carrier in context — so this asks for one first, then hands off to
 * the same dialogs the order form uses. Reusing them keeps one definition of
 * what registering a driver or a vehicle means.
 */
export function RegisterPartnerDialog({
    target,
    open,
    onOpenChange,
}: {
    target: RegisterTarget
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const [carrierId, setCarrierId] = useState<string | undefined>()

    const needsCarrier = target.kind !== "organization"
    const carrierChosen = !needsCarrier || Boolean(carrierId)

    // Reopening starts at the carrier step again rather than reusing
    // whichever carrier the last registration happened to pick
    const reset = (next: boolean) => {
        if (!next) setCarrierId(undefined)
        onOpenChange(next)
    }

    // A new partner changes every count and list on the page
    const refresh = async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.partners.pathKey() })
        reset(false)
    }

    if (needsCarrier && !carrierChosen) {
        return <CarrierStep open={open} onOpenChange={reset} onPicked={setCarrierId} />
    }

    if (target.kind === "organization") {
        return (
            <RegisterOrganizationDialog
                type={target.type}
                initialName=""
                open={open}
                onOpenChange={reset}
                onRegistered={refresh}
            />
        )
    }

    if (target.kind === "driver") {
        return (
            <RegisterDriverDialog
                carrierId={carrierId!}
                initialName=""
                open={open}
                onOpenChange={reset}
                onRegistered={refresh}
            />
        )
    }

    return (
        <RegisterVehicleDialog
            kind={target.vehicle}
            carrierId={carrierId!}
            initialPlate=""
            open={open}
            onOpenChange={reset}
            onRegistered={refresh}
        />
    )
}

/** Picks the carrier the new driver or vehicle will belong to. */
function CarrierStep({
    open,
    onOpenChange,
    onPicked,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onPicked: (carrierId: string) => void
}) {
    const t = useTranslations("Admin.partners.register")

    // The org picker is a react-hook-form control, so it needs a form to
    // live in even though this step only collects one value
    const form = useForm<{ carrierName: string }>({ defaultValues: { carrierName: "" } })
    const [selected, setSelected] = useState<string | undefined>()

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("carrier.title")}</DialogTitle>
                    <DialogDescription>{t("carrier.description")}</DialogDescription>
                </DialogHeader>

                <OrganizationInput
                    control={form.control}
                    name="carrierName"
                    orgType="carrier"
                    label={t("carrier.label")}
                    placeholder={t("carrier.placeholder")}
                    setOrgId={setSelected}
                />

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        {t("carrier.cancel")}
                    </Button>
                    <Button type="button" disabled={!selected} onClick={() => selected && onPicked(selected)}>
                        {t("carrier.continue")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
