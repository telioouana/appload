"use client"

import { useState } from "react";
import { useFormatter } from "@workspace/i18n";
import { IconCalendar } from "@tabler/icons-react";

import { Base } from "@workspace/ui/inputs/base";
import { Calendar } from "@workspace/ui/components/calendar"
import { ControlFunc } from "@workspace/ui/inputs/types";
import { Popover, PopoverContent, PopoverTrigger, } from "@workspace/ui/components/popover"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@workspace/ui/components/input-group";

export const DateInput: ControlFunc<{
    value?: Date
}> = ({
    value,
    ...props
}) => {
    const [open, setOpen] = useState(false)

    const f = useFormatter()

    // A locked or pending field must never open the calendar — the trigger
    // wraps the whole input group, so gate the popover itself, not just the
    // icon: a click on the group padding would otherwise still open it and
    // a pick would mark the field dirty
    const inactive = Boolean(props.isPending || props.disabled)

    return (
        <Base {...props}>
            {(field) => (
                <Popover open={open && !inactive} onOpenChange={(next) => !inactive && setOpen(next)}>
                    <PopoverTrigger asChild>
                        <InputGroup className="w-full">
                            <InputGroupInput
                                {...field}
                                type="text"
                                autoComplete="off"
                                className="w-full"
                                value={field.value ? f.dateTime(field.value, {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                    timeZone: "CAT"
                                }) : ""}
                                disabled={inactive}
                                placeholder={props.placeholder}
                                readOnly
                            />

                            <InputGroupAddon>
                                <InputGroupText
                                    onClick={() => !inactive && setOpen(true)}
                                    className={inactive ? "cursor-not-allowed opacity-50" : "cursor-pointer"}
                                >
                                    <IconCalendar />
                                </InputGroupText>
                            </InputGroupAddon>
                        </InputGroup>
                    </PopoverTrigger>
                    <PopoverContent className="w-full overflow-hidden p-0" align="start">
                        <Calendar
                            mode="single"
                            className="w-full"
                            selected={field.value}
                            captionLayout="dropdown"
                            onSelect={(date) => {
                                if (date && !inactive) {
                                    field.onChange(date)
                                }
                                setOpen(false)
                            }}
                            disabled={(date) => date < new Date(value ? value.setHours(0, 0, 0, 0) : new Date().setHours(0, 0, 0, 0))}
                        />
                    </PopoverContent>
                </Popover>
            )}
        </Base>
    )
}
