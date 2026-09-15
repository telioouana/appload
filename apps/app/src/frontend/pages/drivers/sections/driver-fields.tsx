"use client"

import { useWatch, type Control } from "react-hook-form"

import { useTranslations } from "@workspace/i18n"

import { TextInput } from "@workspace/ui/inputs/text"
import { EmailInput } from "@workspace/ui/inputs/email"
import { PhoneInput } from "@workspace/ui/inputs/phone"
import { FieldGroup } from "@workspace/ui/components/field"

import type { RegisterDriverForm } from "@/backend/schemas/register-driver"

/**
 * The four fields a driver is, shared by the register and edit dialogs so the
 * two can never drift apart.
 *
 * `PhoneInput` renders the dial code beside the field and keeps it out of the
 * value, so the country is a sibling form field; `toE164` folds the two back
 * together at submit, which is what the schema's refinement validates.
 */
export function DriverFields({
    control,
    setCountry,
    isPending,
}: {
    control: Control<RegisterDriverForm>
    setCountry: (country: string) => void
    isPending: boolean
}) {
    const t = useTranslations("App.drivers.register.fields")

    const country = useWatch({ control, name: "country" })

    return (
        <FieldGroup className="gap-4">
            <TextInput
                name="name"
                control={control}
                isPending={isPending}
                label={t("name.label")}
                placeholder={t("name.placeholder")}
            />

            {/* No `placeholder`: PhoneInput supplies its own from the country */}
            <PhoneInput
                name="phoneNumber"
                control={control}
                isPending={isPending}
                country={country}
                setCountry={setCountry}
                label={t("phone.label")}
                description={t("phone.description")}
            />

            <EmailInput
                name="email"
                control={control}
                isPending={isPending}
                label={t("email.label")}
                placeholder={t("email.placeholder")}
                description={t("email.description")}
            />

            <TextInput
                name="passport"
                control={control}
                isPending={isPending}
                label={t("passport.label")}
                placeholder={t("passport.placeholder")}
            />
        </FieldGroup>
    )
}
