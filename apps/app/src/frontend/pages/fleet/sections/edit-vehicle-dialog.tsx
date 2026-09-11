"use client"

import { toast } from "sonner"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { IconCancel, IconCheck, IconLoader2 } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { TextInput } from "@workspace/ui/inputs/text"
import { Button } from "@workspace/ui/components/button"
import { FieldGroup } from "@workspace/ui/components/field"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { domainErrorCode } from "@workspace/trpc/errors"
import { useFleetMutations } from "@/frontend/pages/fleet/hooks/use-fleet-mutations"
import { EditVehicleSchema, type EditVehicleForm } from "@/backend/schemas/register-fleet"
import type { VehicleKind } from "@/frontend/pages/fleet/types"

const EDIT_ERROR_CODES = [
    "DUPLICATE_PLATE",
    "DUPLICATE_VIN",
    "PLATE_UNAVAILABLE",
    "VIN_UNAVAILABLE",
    "PLATE_LOCKED",
    "BAY_REQUIRED",
    "NOT_ALLOWED",
    "NOT_FOUND",
    "UNKNOWN",
] as const

type EditErrorCode = (typeof EDIT_ERROR_CODES)[number]

/**
 * Edits a registered vehicle. Only the fields the user actually touched
 * travel, so an untouched VIN is never re-validated against them and a plate
 * that orders already reference is only refused when it is the thing being
 * changed.
 *
 * The loading bay and the truck type are deliberately not editable here: both
 * change what the vehicle can carry, which is what an order was priced on.
 */
export function EditVehicleDialog({
    kind,
    id,
    values,
    open,
    onOpenChange,
}: {
    kind: VehicleKind
    id: string
    values: EditVehicleForm
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const t = useTranslations("App.fleet")
    const schema = useMemo(() => EditVehicleSchema(t), [t])
    const { updateVehicle } = useFleetMutations()

    const [error, setError] = useState<EditErrorCode | null>(null)

    const form = useForm<EditVehicleForm>({ resolver: zodResolver(schema), defaultValues: values })

    useEffect(() => {
        if (open) form.reset(values)
    }, [open, values, form])

    const isPending = updateVehicle.isPending

    async function submit(next: EditVehicleForm) {
        setError(null)

        const dirty = form.formState.dirtyFields
        const patch: Record<string, unknown> = {}

        if (dirty.regPlate) patch.regPlate = next.regPlate
        if (dirty.internalId) patch.internalId = next.internalId || null
        if (dirty.brand) patch.brand = next.brand
        if (dirty.model) patch.model = next.model
        if (dirty.year) patch.year = Number(next.year)
        if (dirty.vin) patch.vin = next.vin.toUpperCase()

        try {
            await updateVehicle.mutateAsync({ kind, id, patch })
            toast.success(t("edit.success"))
            onOpenChange(false)
        } catch (caught) {
            setError(domainErrorCode(caught, EDIT_ERROR_CODES, "UNKNOWN"))
        }
    }

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) setError(null); onOpenChange(next) }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t("edit.title")}</DialogTitle>
                    <DialogDescription>{t("edit.description")}</DialogDescription>
                </DialogHeader>

                <form
                    id="edit-vehicle-form"
                    onSubmit={(event) => {
                        event.stopPropagation()
                        void form.handleSubmit(submit)(event)
                    }}
                >
                    <FieldGroup className="gap-4">
                        <TextInput name="regPlate" control={form.control} isPending={isPending} label={t("edit.fields.plate")} placeholder={t("register.fields.plate.placeholder")} />
                        <TextInput name="internalId" control={form.control} isPending={isPending} label={t("edit.fields.internalId")} placeholder={t("register.fields.internalId.placeholder")} />
                        <TextInput name="brand" control={form.control} isPending={isPending} label={t("edit.fields.brand")} placeholder={t("register.fields.brand.placeholder")} />
                        <TextInput name="model" control={form.control} isPending={isPending} label={t("edit.fields.model")} placeholder={t("register.fields.model.placeholder")} />
                        <TextInput name="year" control={form.control} isPending={isPending} label={t("edit.fields.year")} placeholder={t("register.fields.year.placeholder")} />
                        <TextInput name="vin" control={form.control} isPending={isPending} label={t("edit.fields.vin")} placeholder={t("register.fields.vin.placeholder")} />
                    </FieldGroup>
                </form>

                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>{t(`edit.errors.${error}`)}</AlertDescription>
                    </Alert>
                )}

                <DialogFooter>
                    <Button type="submit" form="edit-vehicle-form" disabled={isPending}>
                        {isPending ? <IconLoader2 className="animate-spin" /> : <IconCheck />}
                        {isPending ? t("edit.saving") : t("edit.save")}
                    </Button>
                    <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
                        <IconCancel />
                        {t("edit.cancel")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
