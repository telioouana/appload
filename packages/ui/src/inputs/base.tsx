"use client"

import { Controller, FieldPath, FieldValues } from "react-hook-form"


import { BaseProps } from "@workspace/ui/inputs/types"
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@workspace/ui/components/field"

export function Base<
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
    TTransformedValues = TFieldValues
>({
    children,
    control,
    controlFirst,
    description,
    horizontal,
    isPending,
    label,
    name,
}: BaseProps<TFieldValues, TName, TTransformedValues>) {
    return (
        <Controller
            control={control}
            name={name}
            render={({ field, fieldState }) => {
                const control = (
                    children({
                        ...field,
                        id: field.name,
                        "aria-invalid": fieldState.invalid
                    })
                )

                const error = fieldState.invalid && <FieldError errors={[fieldState.error]} />
                return (
                    <Field
                        aria-disabled={isPending}
                        data-invalid={fieldState.invalid}
                        orientation={horizontal ? "horizontal" : undefined}
                    >
                        {controlFirst
                            ? (
                                <>
                                    {control}
                                    <FieldContent>
                                        <FieldLabel htmlFor={field.name} >{label}</FieldLabel>
                                        {error}
                                        {description && <FieldDescription>{description}</FieldDescription>}
                                    </FieldContent>
                                </>
                            ) : (
                                <>
                                    <FieldContent>
                                        <FieldLabel htmlFor={field.name} >{label}</FieldLabel>
                                    </FieldContent>
                                    {control}
                                    {error}
                                    {description && <FieldDescription>{description}</FieldDescription>}
                                </>
                            )}
                    
                    </Field>
                )
            }}
        />
    )
}