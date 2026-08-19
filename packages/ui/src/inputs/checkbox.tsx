"use client"

import { Base } from "@workspace/ui/inputs/base";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { ControlFunc } from "@workspace/ui/inputs/types";

export const CheckboxInput: ControlFunc = props => {
    return <Base
        {...props}
        horizontal
        controlFirst
    >
        {({ onChange, value, ...field }) => (
            <Checkbox {...field} checked={value} onCheckedChange={onChange} disabled={props.isPending} />
        )}
    </Base>
}