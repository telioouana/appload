"use client"

import { IconWeight } from "@tabler/icons-react";
import { Select as SelectPrimitive } from "radix-ui"

import { WEIGHT_UNIT } from "@workspace/db/types";

import { Base } from "@workspace/ui/inputs/base";
import { ControlFunc } from "@workspace/ui/inputs/types";
import { Select, SelectContent, SelectItem, SelectValue } from "@workspace/ui/components/select"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@workspace/ui/components/input-group";

export const WeightInput: ControlFunc<{
    value: typeof WEIGHT_UNIT[number]
    setValue: (value: typeof WEIGHT_UNIT[number]) => void
    disabled?: boolean
}> = ({
    value,
    setValue,
    disabled,
    ...props
}) => {
        return (
            <Base {...props}>
                {(field) => (
                    <InputGroup>
                        <InputGroupInput
                            {...field}
                            type="text"
                            inputMode="decimal"
                            className="w-full"
                            autoComplete="off"
                            value={field.value ?? ""}
                            onChange={(e) => {
                                // Digits and a single decimal point, capped at 3
                                // decimals — the weight columns are numeric(10,3)
                                const sanitized = e.target.value
                                    .replace(/[^0-9.]/g, "")
                                    .replace(/(\..*)\./g, "$1")
                                    .replace(/(\.\d{3})\d+$/, "$1");

                                // Update the value directly
                                e.target.value = sanitized;

                                // Pass it to React Hook Form
                                field.onChange(e);
                            }}
                            disabled={props.isPending}
                            placeholder={props.placeholder}
                        />

                        <InputGroupAddon>
                            <InputGroupText><IconWeight /></InputGroupText>
                        </InputGroupAddon>

                        <InputGroupAddon align="inline-end">
                            <Select disabled={disabled} value={value} onValueChange={setValue}>
                                <SelectPrimitive.Trigger
                                    asChild
                                    className="ring-0 border-0 outline-0"
                                >
                                    <InputGroupButton
                                        variant="ghost"
                                        size="xs"
                                        className="ring-0 border-0 outline-0"
                                    >
                                        <SelectValue />
                                    </InputGroupButton>
                                </SelectPrimitive.Trigger>
                                <SelectContent align="end" position="popper">
                                    {WEIGHT_UNIT.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </InputGroupAddon>
                    </InputGroup>
                )
                }
            </Base >
        )
    }