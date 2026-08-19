"use client"

import { IconListCheck } from "@tabler/icons-react";
import { PropsWithChildren } from "react";

import { Base } from "@workspace/ui/inputs/base";
import { ControlFunc } from "@workspace/ui/inputs/types";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@workspace/ui/components/select"

export const SelectInput: ControlFunc<PropsWithChildren> = ({
    children,
    ...props
}) => {
    return (
        <Base {...props}>
            {({ onChange, onBlur, ...field }) => (
                <Select
                    {...field}
                    onValueChange={onChange}
                >
                    <SelectTrigger
                        id={field.id}
                        onBlur={onBlur}
                        className="w-full"
                        disabled={props.isPending || props.disabled}
                        aria-invalid={field["aria-invalid"]}
                    >
                        <div className="flex items-center gap-3">
                            <IconListCheck />
                            <SelectValue placeholder={props.placeholder} />
                        </div>
                    </SelectTrigger>
                    <SelectContent className="w-full" position="popper">
                        {children}
                    </SelectContent>
                </Select>
            )}
        </Base>
    )
}