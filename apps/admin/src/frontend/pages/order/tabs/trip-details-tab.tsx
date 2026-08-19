"use client"

import { FormProvider, type UseFormReturn } from "react-hook-form"

import type { UpdateOrderForm, UpdateOrderFormInput } from "@/backend/schemas/order"

import { TripDetailsForm } from "../forms/trip-details-form"

type TabProps = {
    form: UseFormReturn<UpdateOrderFormInput, unknown, UpdateOrderForm>
    isPending: boolean
    onSubmit: (values: UpdateOrderForm) => void
    onInvalid?: Parameters<UseFormReturn<UpdateOrderFormInput, unknown, UpdateOrderForm>["handleSubmit"]>[1]
}

export function TripDetailsTab({ form, isPending, onSubmit, onInvalid }: TabProps) {
    return (
        <FormProvider {...form}>
            <form
                id="trip-details-form"
                onSubmit={form.handleSubmit(onSubmit, onInvalid)}
                className="px-6 pb-4 container-snap"
            >
                <TripDetailsForm isPending={isPending} />
            </form>
        </FormProvider>
    )
}
