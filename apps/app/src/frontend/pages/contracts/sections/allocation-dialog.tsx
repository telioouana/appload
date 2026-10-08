"use client"

import { useMemo, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { useQuery } from "@tanstack/react-query"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

import { useTranslations } from "@workspace/i18n"
import { hasModule } from "@workspace/auth/organization-modules"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { SelectItem } from "@workspace/ui/components/select"
import { FieldGroup } from "@workspace/ui/components/field"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import { SelectInput } from "@workspace/ui/inputs/select"
import { CheckboxInput } from "@workspace/ui/inputs/checkbox"
import { DecimalInput } from "@workspace/ui/inputs/decimal"
import { TextInput } from "@workspace/ui/inputs/text"
import { TextAreaInput } from "@workspace/ui/inputs/textarea"

import { useTRPC } from "@/backend/api/client"
import { NONE, TYPED } from "@/backend/schemas/movement"
import { useContractMutations } from "@/frontend/pages/contracts/hooks/use-contract-mutations"
import { contractErrorKey, type ContractErrorCode } from "@/frontend/pages/contracts/lib/errors"
import { EMPTY_PRICE, PriceFormSchema, fromPriceModel, toPriceModel, type PriceForm } from "@/frontend/pages/contracts/lib/price-form"
import { unitOf, useUnitLabel } from "@/frontend/pages/contracts/sections/badges"
import { PriceModelFields } from "@/frontend/pages/contracts/sections/price-model-fields"
import type { AllocationView, ContractDetail } from "@/frontend/pages/contracts/types"

/** The picker value for the owner's own trucks — beside NONE and TYPED from the load form. */
const OWN = "__own"

type AllocationForm = {
    /** OWN, a partner's organization id, or TYPED */
    who: string
    carrierName: string
    /** No fixed share: trucks are sent while there is cargo */
    openShare: boolean
    shareQty: string
    buyPrice: PriceForm
    truckId: string
    driverId: string
    truckPlate: string
    notes: string
}

export type AllocationDialogMode =
    | { kind: "create"; contract: ContractDetail }
    | { kind: "edit"; contract: ContractDetail; allocation: AllocationView }

const positive = (value: string) => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 1e9

function defaultsFor(mode: AllocationDialogMode, ownFleet: boolean): AllocationForm {
    if (mode.kind === "create") {
        return { who: ownFleet ? OWN : TYPED, carrierName: "", openShare: false, shareQty: "", buyPrice: EMPTY_PRICE, truckId: NONE, driverId: NONE, truckPlate: "", notes: "" }
    }

    const { allocation } = mode

    return {
        who: allocation.carrier ? allocation.carrier.id ?? TYPED : OWN,
        carrierName: allocation.carrier?.id ? "" : allocation.carrier?.name ?? "",
        openShare: allocation.shareQty === null,
        shareQty: allocation.shareQty === null ? "" : String(allocation.shareQty),
        buyPrice: fromPriceModel(allocation.buyPrice),
        truckId: allocation.truck?.id ?? NONE,
        driverId: allocation.driver?.id ?? NONE,
        truckPlate: allocation.truckPlate ?? "",
        notes: allocation.notes ?? "",
    }
}

/**
 * Allocating a share of the contract, or changing one: who moves it, how
 * much, at what price, and — for the owner's own trucks or a transporter
 * off the portal — which rig. A transporter on the portal names its own
 * rig, so it is not asked here; the owner's own fleet has no buy price.
 */
export function AllocationDialog({ mode, onClose }: { mode: AllocationDialogMode; onClose: () => void }) {
    const t = useTranslations("App.contracts")
    // The rig pickers' "none" rows are the load form's words
    const tl = useTranslations("App.loads.form")
    const trpc = useTRPC()
    const unitLabel = useUnitLabel()

    const { addAllocation, updateAllocation } = useContractMutations()
    const [error, setError] = useState<ContractErrorCode | null>(null)

    const { contract } = mode
    const editing = mode.kind === "edit"
    const isPending = addAllocation.isPending || updateAllocation.isPending

    const { data: options } = useQuery(trpc.movements.formOptions.queryOptions())
    // Without the own-fleet module a share is always a transporter's
    const { data: session } = useQuery(trpc.me.session.queryOptions())
    const ownFleet = session ? hasModule(session.modules, "own-fleet") : true
    // Appload is pinned in front by the server, and is a transporter as far
    // as a share is concerned: anything that is not a client can move it
    const carriers = (options?.partners ?? []).filter((row) => row.type !== "shipper")

    const FormSchema = useMemo(() => {
        const quantity = t("errors.QUANTITY_REQUIRED")

        return z
            .object({
                who: z.string(),
                carrierName: z.string().trim().max(120),
                openShare: z.boolean(),
                shareQty: z.string(),
                buyPrice: PriceFormSchema(quantity),
                truckId: z.string(),
                driverId: z.string(),
                truckPlate: z.string().trim().max(60),
                notes: z.string().trim().max(2000),
            })
            // An open share has no quantity to check
            .refine((data) => data.openShare || positive(data.shareQty), { message: quantity, path: ["shareQty"] })
            .refine((data) => data.who !== TYPED || data.carrierName.length > 0, {
                message: t("allocation-form.errors.name"),
                path: ["carrierName"],
            })
    }, [t])

    const form = useForm<AllocationForm>({
        resolver: zodResolver(FormSchema),
        defaultValues: defaultsFor(mode, ownFleet),
    })

    const [who, openShare] = useWatch({ control: form.control, name: ["who", "openShare"] })
    const own = who === OWN
    const typed = who === TYPED

    function onSubmit(values: AllocationForm) {
        setError(null)

        const input = {
            carrierOrgId: own || typed ? null : values.who,
            carrierName: typed ? values.carrierName.trim() : null,
            shareQty: values.openShare ? null : Number(values.shareQty),
            buyPrice: own ? null : toPriceModel(values.buyPrice),
            truckId: own && values.truckId !== NONE ? values.truckId : null,
            driverId: own && values.driverId !== NONE ? values.driverId : null,
            truckPlate: typed ? values.truckPlate.trim() || null : null,
            notes: values.notes.trim() || null,
        }
        const handlers = { onSuccess: onClose, onError: (failure: unknown) => setError(contractErrorKey(failure)) }

        if (mode.kind === "edit") updateAllocation.mutate({ id: mode.allocation.id, ...input }, handlers)
        else addAllocation.mutate({ contractId: contract.id, ...input }, handlers)
    }

    return (
        <Dialog open onOpenChange={(next) => { if (!next && !isPending) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t(editing ? "allocation-form.edit-title" : "allocation-form.new-title")}</DialogTitle>
                    <DialogDescription>{t("allocation-form.description")}</DialogDescription>
                </DialogHeader>

                <form id="allocation-form" onSubmit={form.handleSubmit(onSubmit)}>
                    <FieldGroup className="gap-4">
                        <SelectInput control={form.control} name="who" isPending={isPending} label={t("allocation-form.fields.carrier")}>
                            {ownFleet && <SelectItem value={OWN}>{t("allocation-form.fields.own-fleet")}</SelectItem>}
                            {carriers.map((row) => (
                                <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
                            ))}
                            <SelectItem value={TYPED}>{t("form.picker.typed")}</SelectItem>
                        </SelectInput>

                        {typed && (
                            <TextInput control={form.control} name="carrierName" isPending={isPending} label={t("allocation-form.fields.carrier-name")} />
                        )}

                        <CheckboxInput
                            control={form.control}
                            name="openShare"
                            isPending={isPending}
                            label={t("values.open")}
                            description={t("allocation-form.fields.open-hint")}
                        />

                        {!openShare && (
                            <DecimalInput
                                control={form.control}
                                name="shareQty"
                                isPending={isPending}
                                label={t("allocation-form.fields.share-qty")}
                                description={contract.committedQty === null
                                    ? t("values.open")
                                    : t("values.of", { total: unitLabel(unitOf(contract.basis), contract.committedQty) })}
                            />
                        )}

                        {!own && (
                            <PriceModelFields
                                control={form.control}
                                name="buyPrice"
                                basis={contract.basis}
                                currency={contract.currency}
                                disabled={isPending}
                                label={t("allocation-form.fields.buy-price")}
                            />
                        )}

                        {/* The owner's own rig is picked from its fleet; a transporter on
                            the portal names its own; one off the portal has a plate typed */}
                        {own && (
                            <FieldGroup className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                                <SelectInput control={form.control} name="truckId" isPending={isPending} label={t("allocation-form.fields.truck")}>
                                    <SelectItem value={NONE}>{tl("fields.truck-none")}</SelectItem>
                                    {(options?.trucks ?? []).map((row) => (
                                        <SelectItem key={row.id} value={row.id}>{row.plate}</SelectItem>
                                    ))}
                                </SelectInput>
                                <SelectInput control={form.control} name="driverId" isPending={isPending} label={t("allocation-form.fields.driver")}>
                                    <SelectItem value={NONE}>{tl("fields.driver-none")}</SelectItem>
                                    {(options?.drivers ?? []).map((row) => (
                                        <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
                                    ))}
                                </SelectInput>
                            </FieldGroup>
                        )}

                        {typed && (
                            <TextInput control={form.control} name="truckPlate" isPending={isPending} label={t("allocation-form.fields.truck-plate")} />
                        )}

                        <TextAreaInput control={form.control} name="notes" isPending={isPending} label={t("allocation-form.fields.notes")} />

                        {error && (
                            <Alert variant="destructive">
                                <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                            </Alert>
                        )}
                    </FieldGroup>
                </form>

                <DialogFooter>
                    <Button variant="outline" disabled={isPending} onClick={onClose}>
                        {t("form.cancel")}
                    </Button>
                    <Button type="submit" form="allocation-form" disabled={isPending}>
                        {isPending && <Spinner className="size-4" />}
                        {isPending ? t("form.saving") : t("allocation-form.submit")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
