"use client"

import { IconUser } from "@tabler/icons-react";

import { Base } from "@workspace/ui/inputs/base";
import { ControlFunc } from "@workspace/ui/inputs/types";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@workspace/ui/components/input-group";

export const UsernameInput: ControlFunc<{
    example?: string,
}> = ({
    example,
    ...props
}) => {
        return (
            <Base {...props}>
                {(field) => (
                    <InputGroup>
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

                        <InputGroupAddon>
                            <InputGroupText><IconUser /></InputGroupText>
                        </InputGroupAddon>

                        {example && (
                            <InputGroupAddon align="inline-end">
                                <InputGroupText>{example}</InputGroupText>
                            </InputGroupAddon>
                        )}
                    </InputGroup>
                )}
            </Base>
        )
    }