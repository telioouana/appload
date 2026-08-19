import { ControllerProps, FieldPath, FieldValues } from "react-hook-form"

export type BaseProps<
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
    TTransformedValues = TFieldValues
> = ControlProps<TFieldValues, TName, TTransformedValues> & {
    children: (field: Parameters<ControllerProps<TFieldValues, TName, TTransformedValues>["render"]>[0]["field"] & {
        "aria-invalid": boolean
        id: string
    }) => React.ReactNode
    controlFirst?: boolean
    horizontal?: boolean
}

export type ControlProps<
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
    TTransformedValues = TFieldValues
> = {
    control: ControllerProps<TFieldValues, TName, TTransformedValues>["control"]
    name: TName
    label?: React.ReactNode
    description?: React.ReactNode
    placeholder?: string
    type?: string
    isPending?: boolean
    disabled?: boolean
}

export type ControlFunc<ExtraProps extends Record<string, unknown> = Record<never, never>> = <
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
    TTransformedValues = TFieldValues
>(props: ControlProps<TFieldValues, TName, TTransformedValues> & ExtraProps) => React.ReactNode
