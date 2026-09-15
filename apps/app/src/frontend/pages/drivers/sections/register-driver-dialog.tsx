"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { IconCancel, IconCheck, IconLoader2 } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { DEFAULT_PHONE_COUNTRY, toE164 } from "@workspace/ui/lib/phone"

import { Button } from "@workspace/ui/components/button"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { domainErrorCode } from "@workspace/trpc/errors"
import { DriverFields } from "@/frontend/pages/drivers/sections/driver-fields"
import { useDriverMutations } from "@/frontend/pages/drivers/hooks/use-driver-mutations"
import type { DriverOption } from "@/frontend/pages/drivers/server/procedures"
import { RegisterDriverSchema, type RegisterDriverForm } from "@/backend/schemas/register-driver"

const ERROR_MESSAGE_KEYS = {
    "INVALID": "invalid",
    "UNAUTHORIZED": "unauthorized",
    "NOT_ALLOWED": "notAllowed",
    "DUPLICATE_EMAIL": "duplicateEmail",
    "DUPLICATE_PHONE": "duplicatePhone",
    "UNKNOWN": "unknown",
} as const

type DriverErrorCode = keyof typeof ERROR_MESSAGE_KEYS

const DRIVER_ERROR_CODES = Object.keys(ERROR_MESSAGE_KEYS) as DriverErrorCode[]

const defaultValues = (name: string): RegisterDriverForm => ({
    name,
    country: DEFAULT_PHONE_COUNTRY,
    phoneNumber: "",
    email: "",
    passport: "",
})

/**
 * Registers a driver into the signed-in carrier's own roster. The account is
 * created server-side, so nothing here chooses a password or an account type;
 * the email is optional and the procedure stands a placeholder in when it is
 * left blank.
 */
export function RegisterDriverDialog({
    initialName = "",
    open,
    onOpenChange,
    onRegistered,
}: {
    initialName?: string
    open: boolean
    onOpenChange: (open: boolean) => void
    onRegistered?: (driver: DriverOption) => void
}) {
    const t = useTranslations("App.drivers")

    const FormSchema = useMemo(() => RegisterDriverSchema(t), [t])

    const { registerDriver } = useDriverMutations()

    const isPending = registerDriver.isPending
    const [error, setError] = useState<DriverErrorCode | null>(null)

    const form = useForm<RegisterDriverForm>({
        resolver: zodResolver(FormSchema),
        defaultValues: defaultValues(initialName),
    })

    // Re-seed the form with the searched name each time the dialog opens
    useEffect(() => {
        if (open) form.reset(defaultValues(initialName))
    }, [open, initialName, form])

    function handleOpenChange(next: boolean) {
        if (!next) setError(null)
        onOpenChange(next)
    }

    function onSubmit(values: RegisterDriverForm) {
        setError(null)

        registerDriver.mutate(
            {
                name: values.name,
                phoneNumber: toE164(values.country, values.phoneNumber),
                // Blank means "no email"; the procedure stands one in
                email: values.email || undefined,
                passport: values.passport || undefined,
            },
            {
                onSuccess: (driver) => {
                    onRegistered?.(driver)
                    onOpenChange(false)
                },
                onError: (err) => setError(domainErrorCode(err, DRIVER_ERROR_CODES, "UNKNOWN")),
            },
        )
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t("register.title")}</DialogTitle>
                    <DialogDescription>{t("register.description")}</DialogDescription>
                </DialogHeader>

                <form
                    id="register-driver-form"
                    onSubmit={(event) => {
                        // The dialog renders in a portal, so React bubbles this
                        // submit to any form that opened it
                        event.stopPropagation()
                        void form.handleSubmit(onSubmit)(event)
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
                        <AlertDescription>{t(`register.errors.${ERROR_MESSAGE_KEYS[error]}`)}</AlertDescription>
                    </Alert>
                )}

                <DialogFooter>
                    <Button type="submit" form="register-driver-form" disabled={isPending}>
                        {isPending ? <IconLoader2 className="animate-spin" /> : <IconCheck />}
                        {isPending ? t("register.actions.saving") : t("register.actions.save")}
                    </Button>
                    <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
                        <IconCancel />
                        {t("register.actions.cancel")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
