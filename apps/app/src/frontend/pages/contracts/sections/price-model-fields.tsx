"use client"

import { useWatch, type Control, type FieldValues } from "react-hook-form"

import { useTranslations } from "@workspace/i18n"

import { SelectItem } from "@workspace/ui/components/select"
import { FieldGroup } from "@workspace/ui/components/field"
import { DecimalInput } from "@workspace/ui/inputs/decimal"
import { SelectInput } from "@workspace/ui/inputs/select"

import { modelsFor } from "@/frontend/pages/contracts/lib/price-form"
import type { ContractBasis, Currency } from "@/frontend/pages/contracts/types"

/**
 * One price block as a form holds it (see `PriceForm`): the model, then only
 * the amounts that model needs. The contract sheet prices what the client
 * pays with it; the allocation dialog what a transporter is paid. The models
 * on offer are the ones that can price what the contract counts.
 */
export function PriceModelFields<T extends FieldValues>({
    control: typed,
    name,
    basis,
    currency,
    disabled,
    label,
}: {
    control: Control<T>
    name: string
    disabled?: boolean
    basis: ContractBasis
    currency: Currency
    label: string
}) {
    const t = useTranslations("App.contracts.price-models")

    // The block's field names are built from `name`, which no host form's
    // path type can express; the host's own schema types the values
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- react-hook-form's Control is contravariant in its form type; every caller passes its own typed control
    const control = typed as unknown as Control<any>

    const model = useWatch({ control, name: `${name}.model` }) as string | undefined

    return (
        <div className="bg-muted/30 flex flex-col gap-3 rounded-2xl px-4 py-3.5">
            <span className="text-sm font-medium">{label}</span>
            <FieldGroup className="gap-4">
                <SelectInput name={`${name}.model`} control={control} isPending={disabled} label={t("model")}>
                    {modelsFor(basis).map((item) => (
                        <SelectItem key={item} value={item}>{t(item)}</SelectItem>
                    ))}
                </SelectInput>

                {(model === "per-trip" || model === "per-ton" || model === "per-day") && (
                    <FieldGroup className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                        <DecimalInput
                            name={`${name}.rate`}
                            control={control}
                            isPending={disabled}
                            label={`${t("rate")} (${currency})`}
                            placeholder="0.00"
                        />
                        {model === "per-ton" && (
                            <DecimalInput
                                name={`${name}.minBillableTons`}
                                control={control}
                                isPending={disabled}
                                label={t("min-billable-tons")}
                                placeholder="0"
                            />
                        )}
                        {model === "per-day" && (
                            <SelectInput name={`${name}.billableDays`} control={control} isPending={disabled} label={t("billable-days")}>
                                {(["calendar", "working"] as const).map((item) => (
                                    <SelectItem key={item} value={item}>{t(item)}</SelectItem>
                                ))}
                            </SelectInput>
                        )}
                    </FieldGroup>
                )}

                {model === "lump-sum" && (
                    <DecimalInput
                        name={`${name}.total`}
                        control={control}
                        isPending={disabled}
                        label={`${t("total")} (${currency})`}
                        placeholder="0.00"
                    />
                )}
            </FieldGroup>
        </div>
    )
}
