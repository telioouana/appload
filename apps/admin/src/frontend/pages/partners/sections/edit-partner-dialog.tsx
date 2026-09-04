"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { IconCancel, IconCheck, IconLoader2 } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import type { Address } from "@workspace/db/types"

import { TextInput } from "@workspace/ui/inputs/text"
import { Button } from "@workspace/ui/components/button"
import { LocationInput } from "@workspace/ui/inputs/location"
import { FieldGroup } from "@workspace/ui/components/field"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { domainErrorCode } from "@/lib/trpc-error"
import { usePartnerMutations } from "@/frontend/pages/partners/hooks/use-partner-mutations"
import type { VehicleKind } from "@/frontend/pages/partners/types"

const EDIT_ERROR_CODES = ["DUPLICATE_NUIT", "DUPLICATE_EMAIL", "DUPLICATE_PHONE", "DUPLICATE_PLATE", "DUPLICATE_VIN", "NOT_ALLOWED", "NOT_FOUND", "UNKNOWN"] as const

type EditErrorCode = (typeof EDIT_ERROR_CODES)[number]

const EMPTY_LOCATION: Address = { address: "", placeId: "", country: "", state: "" }

type Translate = ReturnType<typeof useTranslations<"Admin.partners.edit">>

const optionalLocation = z.object({
    address: z.string(),
    placeId: z.string(),
    country: z.string(),
    state: z.string(),
})

const organizationSchema = (t: Translate) => z.object({
    name: z.string().trim().nonempty({ error: t("errors.name") }),
    nuit: z.string().trim().regex(/^\d{9}$/, { error: t("errors.nuit") }),
    email: z.email({ error: t("errors.email") }),
    phone: z.string().trim().min(9, { error: t("errors.phone") }),
    representee: z.string().trim().max(120),
    billingAddress: optionalLocation,
    physicalAddress: optionalLocation,
})

const driverSchema = (t: Translate) => z.object({
    name: z.string().trim().nonempty({ error: t("errors.name") }),
    email: z.email({ error: t("errors.email") }),
    phoneNumber: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, { error: t("errors.phone") }),
    passport: z.string().trim().max(40),
})

const vehicleSchema = (t: Translate) => z.object({
    regPlate: z.string().trim().nonempty({ error: t("errors.plate") }),
    internalId: z.string().trim().max(60),
    brand: z.string().trim().nonempty({ error: t("errors.brand") }),
    model: z.string().trim().nonempty({ error: t("errors.model") }),
    year: z.string().trim().regex(/^(19|20)\d{2}$/, { error: t("errors.year") }),
    vin: z.string().trim().regex(/^[A-HJ-NPR-Z0-9]{17}$/i, { error: t("errors.vin") }),
})

export type OrganizationEditValues = z.infer<ReturnType<typeof organizationSchema>>
export type DriverEditValues = z.infer<ReturnType<typeof driverSchema>>
export type VehicleEditValues = z.infer<ReturnType<typeof vehicleSchema>>

type Target =
    | { kind: "organization"; id: string; values: OrganizationEditValues }
    | { kind: "driver"; id: string; values: DriverEditValues }
    | { kind: "vehicle"; vehicle: VehicleKind; id: string; values: VehicleEditValues }

/** Frame shared by the three edit forms: title, error, save/cancel. */
function EditDialog({
    open,
    onOpenChange,
    title,
    formId,
    isPending,
    error,
    children,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    formId: string
    isPending: boolean
    error: string | null
    children: React.ReactNode
}) {
    const t = useTranslations("Admin.partners.edit")

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{t("description")}</DialogDescription>
                </DialogHeader>

                {children}

                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                <DialogFooter>
                    <Button type="submit" form={formId} disabled={isPending}>
                        {isPending ? <IconLoader2 className="animate-spin" /> : <IconCheck />}
                        {isPending ? t("saving") : t("save")}
                    </Button>
                    <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
                        <IconCancel />
                        {t("cancel")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/**
 * Edits for a registered partner. Only the fields the user actually
 * changed travel to the server, so an untouched address is never rewritten
 * and a placeholder the user did not fix is not re-validated against them.
 */
export function EditPartnerDialog({
    target,
    open,
    onOpenChange,
    onSaved,
}: {
    target: Target
    open: boolean
    onOpenChange: (open: boolean) => void
    onSaved?: () => void
}) {
    if (target.kind === "organization") {
        return <EditOrganization id={target.id} values={target.values} open={open} onOpenChange={onOpenChange} onSaved={onSaved} />
    }
    if (target.kind === "driver") {
        return <EditDriver id={target.id} values={target.values} open={open} onOpenChange={onOpenChange} onSaved={onSaved} />
    }
    return <EditVehicle kind={target.vehicle} id={target.id} values={target.values} open={open} onOpenChange={onOpenChange} onSaved={onSaved} />
}

const useEditError = () => {
    const t = useTranslations("Admin.partners.edit")
    const [error, setError] = useState<string | null>(null)

    return {
        error,
        clear: () => setError(null),
        capture: (caught: unknown) => setError(t(`server.${domainErrorCode<EditErrorCode>(caught, EDIT_ERROR_CODES, "UNKNOWN")}`)),
    }
}

function EditOrganization({
    id,
    values,
    open,
    onOpenChange,
    onSaved,
}: {
    id: string
    values: OrganizationEditValues
    open: boolean
    onOpenChange: (open: boolean) => void
    onSaved?: () => void
}) {
    const t = useTranslations("Admin.partners.edit")
    const schema = useMemo(() => organizationSchema(t), [t])
    const { updateOrganization } = usePartnerMutations()
    const { error, clear, capture } = useEditError()

    const form = useForm<OrganizationEditValues>({ resolver: zodResolver(schema), defaultValues: values })

    useEffect(() => {
        if (open) form.reset(values)
    }, [open, values, form])

    const isPending = updateOrganization.isPending

    const submit = async (next: OrganizationEditValues) => {
        clear()
        const dirty = form.formState.dirtyFields
        const patch: Record<string, unknown> = {}

        if (dirty.name) patch.name = next.name
        if (dirty.nuit) patch.nuit = next.nuit
        if (dirty.email) patch.email = next.email
        if (dirty.phone) patch.phone = next.phone
        if (dirty.representee) patch.representee = next.representee || null
        // An address only counts once the picker filled its place id
        if (dirty.billingAddress && next.billingAddress.placeId) patch.billingAddress = next.billingAddress
        if (dirty.physicalAddress && next.physicalAddress.placeId) patch.physicalAddress = next.physicalAddress

        try {
            await updateOrganization.mutateAsync({ id, patch })
            onSaved?.()
            onOpenChange(false)
        } catch (caught) {
            capture(caught)
        }
    }

    return (
        <EditDialog open={open} onOpenChange={(next) => { if (!next) clear(); onOpenChange(next) }} title={t("title.organization")} formId="edit-organization" isPending={isPending} error={error}>
            <form
                id="edit-organization"
                onSubmit={(event) => {
                    event.stopPropagation()
                    void form.handleSubmit(submit)(event)
                }}
            >
                <FieldGroup className="gap-4">
                    <TextInput name="name" control={form.control} isPending={isPending} label={t("fields.name")} placeholder={t("placeholders.name")} />
                    <TextInput name="nuit" control={form.control} isPending={isPending} label={t("fields.nuit")} placeholder={t("placeholders.nuit")} />
                    <TextInput name="representee" control={form.control} isPending={isPending} label={t("fields.representee")} placeholder={t("placeholders.representee")} />
                    <TextInput name="email" control={form.control} isPending={isPending} label={t("fields.email")} placeholder={t("placeholders.email")} />
                    <TextInput name="phone" control={form.control} isPending={isPending} label={t("fields.phone")} placeholder={t("placeholders.phone")} />
                    <LocationInput
                        name="billingAddress.address"
                        control={form.control}
                        isPending={isPending}
                        label={t("fields.billing-address")}
                        placeholder={t("placeholders.address")}
                        setPlaceId={(value) => form.setValue("billingAddress.placeId", value, { shouldDirty: true })}
                        setCountry={(value) => form.setValue("billingAddress.country", value, { shouldDirty: true })}
                        setState={(value) => form.setValue("billingAddress.state", value, { shouldDirty: true })}
                    />
                    <LocationInput
                        name="physicalAddress.address"
                        control={form.control}
                        isPending={isPending}
                        label={t("fields.physical-address")}
                        placeholder={t("placeholders.address")}
                        setPlaceId={(value) => form.setValue("physicalAddress.placeId", value, { shouldDirty: true })}
                        setCountry={(value) => form.setValue("physicalAddress.country", value, { shouldDirty: true })}
                        setState={(value) => form.setValue("physicalAddress.state", value, { shouldDirty: true })}
                    />
                </FieldGroup>
            </form>
        </EditDialog>
    )
}

function EditDriver({
    id,
    values,
    open,
    onOpenChange,
    onSaved,
}: {
    id: string
    values: DriverEditValues
    open: boolean
    onOpenChange: (open: boolean) => void
    onSaved?: () => void
}) {
    const t = useTranslations("Admin.partners.edit")
    const schema = useMemo(() => driverSchema(t), [t])
    const { updateDriver } = usePartnerMutations()
    const { error, clear, capture } = useEditError()

    const form = useForm<DriverEditValues>({ resolver: zodResolver(schema), defaultValues: values })

    useEffect(() => {
        if (open) form.reset(values)
    }, [open, values, form])

    const isPending = updateDriver.isPending

    const submit = async (next: DriverEditValues) => {
        clear()
        const dirty = form.formState.dirtyFields
        const patch: Record<string, unknown> = {}

        if (dirty.name) patch.name = next.name
        if (dirty.email) patch.email = next.email
        if (dirty.phoneNumber) patch.phoneNumber = next.phoneNumber
        if (dirty.passport) patch.passport = next.passport || null

        try {
            await updateDriver.mutateAsync({ id, patch })
            onSaved?.()
            onOpenChange(false)
        } catch (caught) {
            capture(caught)
        }
    }

    return (
        <EditDialog open={open} onOpenChange={(next) => { if (!next) clear(); onOpenChange(next) }} title={t("title.driver")} formId="edit-driver" isPending={isPending} error={error}>
            <form
                id="edit-driver"
                onSubmit={(event) => {
                    event.stopPropagation()
                    void form.handleSubmit(submit)(event)
                }}
            >
                <FieldGroup className="gap-4">
                    <TextInput name="name" control={form.control} isPending={isPending} label={t("fields.name")} placeholder={t("placeholders.driver-name")} />
                    <TextInput name="phoneNumber" control={form.control} isPending={isPending} label={t("fields.phone")} placeholder={t("placeholders.phone")} />
                    <TextInput name="email" control={form.control} isPending={isPending} label={t("fields.email")} placeholder={t("placeholders.email")} />
                    <TextInput name="passport" control={form.control} isPending={isPending} label={t("fields.passport")} placeholder={t("placeholders.passport")} />
                </FieldGroup>
            </form>
        </EditDialog>
    )
}

function EditVehicle({
    kind,
    id,
    values,
    open,
    onOpenChange,
    onSaved,
}: {
    kind: VehicleKind
    id: string
    values: VehicleEditValues
    open: boolean
    onOpenChange: (open: boolean) => void
    onSaved?: () => void
}) {
    const t = useTranslations("Admin.partners.edit")
    const schema = useMemo(() => vehicleSchema(t), [t])
    const { updateVehicle } = usePartnerMutations()
    const { error, clear, capture } = useEditError()

    const form = useForm<VehicleEditValues>({ resolver: zodResolver(schema), defaultValues: values })

    useEffect(() => {
        if (open) form.reset(values)
    }, [open, values, form])

    const isPending = updateVehicle.isPending

    const submit = async (next: VehicleEditValues) => {
        clear()
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
            onSaved?.()
            onOpenChange(false)
        } catch (caught) {
            capture(caught)
        }
    }

    return (
        <EditDialog open={open} onOpenChange={(next) => { if (!next) clear(); onOpenChange(next) }} title={t(`title.${kind}`)} formId="edit-vehicle" isPending={isPending} error={error}>
            <form
                id="edit-vehicle"
                onSubmit={(event) => {
                    event.stopPropagation()
                    void form.handleSubmit(submit)(event)
                }}
            >
                <FieldGroup className="gap-4">
                    <TextInput name="regPlate" control={form.control} isPending={isPending} label={t("fields.plate")} placeholder={t("placeholders.plate")} />
                    <TextInput name="internalId" control={form.control} isPending={isPending} label={t("fields.internal-id")} placeholder={t("placeholders.internal-id")} />
                    <TextInput name="brand" control={form.control} isPending={isPending} label={t("fields.brand")} placeholder={t("placeholders.brand")} />
                    <TextInput name="model" control={form.control} isPending={isPending} label={t("fields.model")} placeholder={t("placeholders.model")} />
                    <TextInput name="year" control={form.control} isPending={isPending} label={t("fields.year")} placeholder={t("placeholders.year")} />
                    <TextInput name="vin" control={form.control} isPending={isPending} label={t("fields.vin")} placeholder={t("placeholders.vin")} />
                </FieldGroup>
            </form>
        </EditDialog>
    )
}

export const emptyLocation = () => ({ ...EMPTY_LOCATION })
