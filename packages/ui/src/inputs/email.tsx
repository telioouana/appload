"use client"

import { IconMail } from "@tabler/icons-react";

import { Base } from "@workspace/ui/inputs/base";
import { ControlFunc } from "@workspace/ui/inputs/types";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@workspace/ui/components/input-group";

export const EmailInput: ControlFunc = (props) => {
    return (
        <Base {...props}>
            {(field) => (
                <InputGroup>
                    <InputGroupInput
                        {...field}
                        type="email"
                        autoComplete="off"
                        className="w-full"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        disabled={props.isPending}
                        placeholder={props.placeholder}
                    />

                    <InputGroupAddon>
                        <InputGroupText><IconMail /></InputGroupText>
                    </InputGroupAddon>
                </InputGroup>
            )}
        </Base>
    )
}