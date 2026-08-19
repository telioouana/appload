"use client"

import { IconAbc } from "@tabler/icons-react";

import { Base } from "@workspace/ui/inputs/base";
import { ControlFunc } from "@workspace/ui/inputs/types";
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "@workspace/ui/components/input-group";

export const TextAreaInput: ControlFunc = (props) => {
    return (
        <Base {...props}>
            {(field) => (
                <InputGroup>
                    <InputGroupTextarea
                        {...field}
                        rows={2}
                        className="w-full"
                        autoComplete="off"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        disabled={props.isPending}
                        placeholder={props.placeholder}
                    />

                    <InputGroupAddon>
                        <InputGroupText><IconAbc /></InputGroupText>
                    </InputGroupAddon>
                </InputGroup>
            )}
        </Base>
    )
}