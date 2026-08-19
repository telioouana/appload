"use client"

import { FormProvider, type UseFormReturn } from "react-hook-form"

import type { UpdateOrderForm, UpdateOrderFormInput } from "@/backend/schemas/order"

import { AccountingDetailsForm } from "../forms/accounting-details-form"

type TabProps = {
    form: UseFormReturn<UpdateOrderFormInput, unknown, UpdateOrderForm>
    isPending: boolean
    // Parties whose paid fields are derived from proofs of payment and
    // therefore read-only in this tab
    lockedParties: Record<"carrier" | "shipper", boolean>
    onSubmit: (values: UpdateOrderForm) => void
    onInvalid?: Parameters<UseFormReturn<UpdateOrderFormInput, unknown, UpdateOrderForm>["handleSubmit"]>[1]
}

export function AccountingDetailsTab({ form, isPending, lockedParties, onSubmit, onInvalid }: TabProps) {
    return (
        <FormProvider {...form}>
            <form
                id="accounting-details-form"
                onSubmit={form.handleSubmit(onSubmit, onInvalid)}
                className="px-6 pb-4 container-snap"
            >
                <AccountingDetailsForm isPending={isPending} lockedParties={lockedParties} />
            </form>
        </FormProvider>
    )
}
