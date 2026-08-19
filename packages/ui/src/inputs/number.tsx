"use client"

import { IconHash } from "@tabler/icons-react";

import { Base } from "@workspace/ui/inputs/base";
import { ControlFunc } from "@workspace/ui/inputs/types";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@workspace/ui/components/input-group";

export const NumberInput: ControlFunc<{
    length?: number
    isNumber?: boolean
}> = ({
    isNumber = true,
    length,
    ...props
}) => {
        return (
            <Base {...props}>
                {(field) => (
                    <InputGroup>
                        <InputGroupInput
                            {...field}
                            type="text"
                            // Use * for zero or more, or + for one or more numbers
                            pattern="[0-9]*"
                            className="w-full"
                            autoComplete="off"
                            value={field.value ?? ""}
                            onChange={(e) => {
                                // This regex removes anything that is NOT (^) a digit (0-9)
                                const sanitized = e.target.value.replace(/[^0-9]/g, "");

                                // Update the value directly
                                e.target.value = sanitized;

                                // Pass it to React Hook Form
                                const val = e.target.value;
                                if (isNumber) {
                                    field.onChange(val === "" ? undefined : Number(val));
                                } else {
                                    field.onChange(val)
                                }
                            }}
                            disabled={props.isPending}
                            placeholder={props.placeholder}
                            maxLength={length}
                        />

                        <InputGroupAddon>
                            <InputGroupText><IconHash /></InputGroupText>
                        </InputGroupAddon>
                    </InputGroup>
                )}
            </Base>
        )
    }