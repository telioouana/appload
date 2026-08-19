"use client"

import { IconCoins } from "@tabler/icons-react";

import { Base } from "@workspace/ui/inputs/base";
import { ControlFunc } from "@workspace/ui/inputs/types";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@workspace/ui/components/input-group";

/**
 * Decimal amounts (money, weights, temperatures). Keeps the raw string in
 * the form state so intermediate values like "12." or "-" stay typable; the
 * zod schema converts to a number on validation.
 */
export const DecimalInput: ControlFunc = (props) => {
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
                            // Digits, an optional leading minus (refrigerated
                            // temperatures are negative) and a single decimal point
                            const sanitized = e.target.value
                                .replace(/[^0-9.-]/g, "")
                                .replace(/(?!^)-/g, "")
                                .replace(/(\..*)\./g, "$1");

                            e.target.value = sanitized;
                            field.onChange(sanitized);
                        }}
                        disabled={props.isPending || props.disabled}
                        placeholder={props.placeholder}
                    />

                    <InputGroupAddon>
                        <InputGroupText><IconCoins /></InputGroupText>
                    </InputGroupAddon>
                </InputGroup>
            )}
        </Base>
    )
}
