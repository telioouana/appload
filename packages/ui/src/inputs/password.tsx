"use client"

import { useState } from "react";
import { IconEye, IconEyeClosed, IconKey } from "@tabler/icons-react";

import { Base } from "@workspace/ui/inputs/base";
import { ControlFunc } from "@workspace/ui/inputs/types";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupButton, InputGroupText } from "@workspace/ui/components/input-group";

export const PasswordInput: ControlFunc = (props) => {
    const [show, setShow] = useState<boolean>(false)

    function changeView() {
        setShow(!show)
    }
    return (
        <Base {...props}>
            {(field) => (
                <InputGroup>
                    <InputGroupInput
                        {...field}
                        autoComplete="off"
                        className="w-full"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        disabled={props.isPending}
                        placeholder={props.placeholder}
                        type={show ? "text" : "password"}
                    />

                    <InputGroupAddon>
                        <InputGroupText><IconKey /></InputGroupText>
                    </InputGroupAddon>

                    <InputGroupAddon align="inline-end">
                        <InputGroupButton
                            variant="ghost"
                            onClick={changeView}
                            disabled={props.isPending}
                        >
                            {show ? <IconEyeClosed /> : <IconEye />}
                        </InputGroupButton>
                    </InputGroupAddon>
                </InputGroup>
            )}
        </Base>
    )
}