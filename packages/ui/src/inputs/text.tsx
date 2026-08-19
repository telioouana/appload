"use client"

import { withMask } from "use-mask-input"
import { IconAbc } from "@tabler/icons-react";

import { Base } from "@workspace/ui/inputs/base";
import { ControlFunc } from "@workspace/ui/inputs/types";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@workspace/ui/components/input-group";

export const TextInput: ControlFunc<{
    hasInputMask?: boolean,
    inputMask?: string
    hasPattern?: boolean,
    pattern?: string,
    regex?: RegExp,
    length?: number,
}> = ({
    hasInputMask,
    inputMask,
    hasPattern,
    pattern,
    regex,
    length,
    ...props
}) => {
        return (
            <Base {...props}>
                {(field) => (
                    <InputGroup>
                        {(hasInputMask && inputMask)
                            && (
                                <InputGroupInput
                                    {...field}
                                    type="text"
                                    ref={withMask(inputMask, {
                                        placeholder: '_',
                                        showMaskOnHover: false
                                    })}
                                    className="w-full"
                                    autoComplete="off"
                                    value={field.value ?? ""}
                                    onChange={field.onChange}
                                    disabled={props.isPending}
                                    placeholder={props.placeholder}
                                />
                            )
                        }

                        {(hasPattern && pattern && regex)
                            && (
                                <InputGroupInput
                                    {...field}
                                    type="text"
                                    pattern={pattern}
                                    className="w-full not-placeholder-shown:Uppercase"
                                    autoComplete="off"
                                    value={field.value ?? ""}
                                    onChange={(e) => {
                                        // 2. Real-time Sanitization:
                                        // This regex removes anything that ISN'T a letter or number
                                        const sanitized = e.target.value.replace(regex, "");

                                        // Force uppercase for VINs (optional but standard)
                                        e.target.value = sanitized.toUpperCase();

                                        // 3. Pass the clean value back to React Hook Form
                                        field.onChange(e);
                                    }}
                                    disabled={props.isPending}
                                    placeholder={props.placeholder}
                                    maxLength={length}
                                />
                            )
                        }

                        {((!hasInputMask && !hasPattern) || (!inputMask && !pattern))
                            && (
                                <InputGroupInput
                                    {...field}
                                    type="text"
                                    className="w-full"
                                    autoComplete="off"
                                    value={field.value ?? ""}
                                    onChange={field.onChange}
                                    disabled={props.isPending}
                                    placeholder={props.placeholder}
                                />
                            )
                        }

                        <InputGroupAddon>
                            <InputGroupText><IconAbc /></InputGroupText>
                        </InputGroupAddon>
                    </InputGroup>
                )}
            </Base>
        )
    }