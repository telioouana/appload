"use client"

import { FormProvider, type UseFormReturn } from "react-hook-form"

import type { UpdateOrderForm, UpdateOrderFormInput } from "@/backend/schemas/order"

import { OrderUpdateForm } from "../forms/update-details-form"

type TabProps = {
    form: UseFormReturn<UpdateOrderFormInput, unknown, UpdateOrderForm>
    isPending: boolean
    onSubmit: (values: UpdateOrderForm) => void
    onInvalid?: Parameters<UseFormReturn<UpdateOrderFormInput, unknown, UpdateOrderForm>["handleSubmit"]>[1]
}

export function OrderDetailsTab({ form, isPending, onSubmit, onInvalid }: TabProps) {
    return (
        <FormProvider {...form}>
            <form
                id="order-details-form"
                onSubmit={form.handleSubmit(onSubmit, onInvalid)}
                className="px-6 pb-4 container-snap"
            >
                <OrderUpdateForm isPending={isPending} />
            </form>
        </FormProvider>
    )
}
