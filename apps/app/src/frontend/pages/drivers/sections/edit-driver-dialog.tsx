"use client"

import { toast } from "sonner"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { IconCancel, IconCheck, IconLoader2 } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { fromE164, toE164 } from "@workspace/ui/lib/phone"

import { Button } from "@workspace/ui/components/button"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { domainErrorCode } from "@/lib/trpc-error"
import { DriverFields } from "@/frontend/pages/drivers/sections/driver-fields"
import { useDriverMutations } from "@/frontend/pages/drivers/hooks/use-driver-mutations"
import { EditDriverSchema, type RegisterDriverForm } from "@/backend/schemas/register-driver"
import { isPlaceholderEmail, type DriverProfile } from "@/frontend/pages/drivers/types"

const EDIT_ERROR_CODES = [
    "DUPLICATE_EMAIL",
    "DUPLICATE_PHONE",
    "EMAIL_LOCKED",
    "NOT_ALLOWED",
    "NOT_FOUND",
    "WRONG_ORGANIZATION_TYPE",
    "UNKNOWN",
] as const

type EditErrorCode = (typeof EDIT_ERROR_CODES)[number]

/**
 * Edits a registered driver. Only the fields the user touched travel, so an
 * untouched placeholder email is never sent back as if it were real — and
 * replacing that placeholder with a working address is just an email edit,
 * which is the whole point of standing one in at registration.
 */
export function EditDriverDialog({
    driver,
    open,
    onOpenChange,
}: {
    driver: DriverProfile
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const t = useTranslations("App.drivers")
    const schema = useMemo(() => EditDriverSchema(t), [t])
    const { updateDriver } = useDriverMutations()

    const [error, setError] = useState<EditErrorCode | null>(null)

    // A stored E.164 number is split back into the pair PhoneInput needs
    const values = useMemo<RegisterDriverForm>(() => {
        const phone = fromE164(driver.phoneNumber)

        return {
            name: driver.name,
            country: phone.country,
            phoneNumber: phone.national,
            email: isPlaceholderEmail(driver.email) ? "" : driver.email,
            passport: driver.passport ?? "",
        }
    }, [driver])

    const form = useForm<RegisterDriverForm>({ resolver: zodResolver(schema), defaultValues: values })

    useEffect(() => {
        if (open) form.reset(values)
    }, [open, values, form])

    const isPending = updateDriver.isPending

    async function submit(next: RegisterDriverForm) {
        setError(null)

        const dirty = form.formState.dirtyFields
        const patch: Record<string, unknown> = {}

        if (dirty.name) patch.name = next.name
        // The number is one value made of two fields, so either one moving
        // sends the composed result
        if (dirty.phoneNumber || dirty.country) patch.phoneNumber = toE164(next.country, next.phoneNumber)
        if (dirty.email && next.email) patch.email = next.email
        if (dirty.passport) patch.passport = next.passport || null

        try {
            await updateDriver.mutateAsync({ id: driver.id, patch })
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
                    id="edit-driver-form"
                    onSubmit={(event) => {
                        event.stopPropagation()
                        void form.handleSubmit(submit)(event)
                    }}
                >
                    <DriverFields
                        control={form.control}
                        isPending={isPending}
                        setCountry={(value) => form.setValue("country", value, { shouldDirty: true, shouldValidate: true })}
                    />
                </form>

                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>{t(`edit.errors.${error}`)}</AlertDescription>
                    </Alert>
                )}

                <DialogFooter>
                    <Button type="submit" form="edit-driver-form" disabled={isPending}>
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
