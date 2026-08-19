"use client"

import { Slider } from "@workspace/ui/components/slider";
import { Base } from "@workspace/ui/inputs/base";
import { ControlFunc } from "@workspace/ui/inputs/types";

import { cn } from "@workspace/ui/lib/utils";

export const SliderInput: ControlFunc<{
    max: number
    min: number
    step: number
    unit?: string
    message: string
}> = ({
    max,
    min,
    step,
    message,
    unit = "º C",
    ...props
}) => {
        return (
            <Base {...props}>
                {({ onChange, ...field }) => (
                    <div className="flex flex-col gap-2 w-full">
                        <div className="flex justify-end items-center gap-2 text-end text-sm">
                            <span className="text-muted-foreground">{message}</span>
                            <span className="text-primary font-semibold">{field.value}{unit}</span>
                        </div>
                        <Slider
                            defaultValue={[field.value]}
                            min={min}
                            max={max}
                            step={step}
                            onValueChange={(value) => {
                                onChange(value[0])
                            }}
                            className={cn("w-full")}
                            disabled={props.isPending}
                        />
                    </div>

                )}
            </Base>
        )
    }