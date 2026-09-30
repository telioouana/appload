"use client"

import { useEffect } from "react"
import { useForm, useWatch } from "react-hook-form"

import { PhoneInput } from "@workspace/ui/inputs/phone"
import { FieldError } from "@workspace/ui/components/field"
import { fromE164, toE164 } from "@workspace/ui/lib/phone"

/**
 * `PhoneInput` for a form whose field holds the whole E.164 number. The order
 * forms validate one `driverPhoneNumber` against a schema shared with the
 * server, so the country and the national part live in a small form of their
 * own here and only the composed number travels out.
 */
export function DriverPhoneInput({
    value,
    onChange,
    error,
    isPending,
    label,
}: {
    value: string | undefined
    onChange: (value: string | undefined) => void
    error?: { message?: string }
    isPending: boolean
    label: string
}) {
    const form = useForm({ defaultValues: split(value) })

    const country = useWatch({ control: form.control, name: "country" })

    // The number changed from outside: a driver was picked
    useEffect(() => {
        const current = form.getValues()

        if (toE164(current.country, current.phoneNumber) !== (value ?? "")) {
            form.reset(split(value))
        }
    }, [value, form])

    useEffect(() => {
        const subscription = form.watch((next, { name }) => {
            // A reset names no field, and is the outside talking
            if (!name) return
            onChange(toE164(next.country ?? "", next.phoneNumber) || undefined)
        })

        return () => subscription.unsubscribe()
    }, [form, onChange])

    return (
        <div className="flex flex-col gap-2">
            <PhoneInput
                name="phoneNumber"
                control={form.control}
                isPending={isPending}
                country={country}
                setCountry={(next) => form.setValue("country", next)}
                label={label}
            />
            {error && <FieldError errors={[error]} />}
        </div>
    )
}

function split(value: string | undefined) {
    const { country, national } = fromE164(value)

    return { country, phoneNumber: national }
}
