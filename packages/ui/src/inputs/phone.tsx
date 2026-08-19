"use client"

import { IconChevronDown, IconPhone } from "@tabler/icons-react";

import { Base } from "@workspace/ui/inputs/base";
import { ControlFunc } from "@workspace/ui/inputs/types";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@workspace/ui/components/command";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@workspace/ui/components/input-group";

import { countryCodes } from "@workspace/ui/lib/country-codes";

export const PhoneInput: ControlFunc<{
    country: string
    setCountry: (country: string) => void
}> = ({
    country,
    setCountry,
    ...props
}) => {
        const selectedCountry = countryCodes.find((data) => data.country === country)

        return <Base {...props}>{field => (
            <InputGroup>
                <InputGroupAddon>
                    <InputGroupText><IconPhone /></InputGroupText>
                </InputGroupAddon>

                <InputGroupAddon>
                    <Popover>
                        <PopoverTrigger className="flex gap-2 items-center" disabled={props.isPending}>
                            <img src={`/flags/${selectedCountry?.iso || "default"}.svg`} alt="flag"className="ml-2 size-4" />
                            <p className="text-muted-foreground">{selectedCountry?.code}</p>
                            <IconChevronDown className="size-4 opacity-50" />
                        </PopoverTrigger>
                        <PopoverContent align="start">
                            <Command>
                                <CommandInput />
                                <CommandEmpty></CommandEmpty>
                                <CommandList className="overflow-y-scroll container-snap h-60">{
                                    countryCodes.map(({ iso, code, country }, index) => {
                                        return (
                                            <CommandItem
                                                key={index}
                                                value={country}
                                                onSelect={() => {
                                                    setCountry(country)
                                                }}
                                            >
                                                <div className="flex w-full justify-evenly">
                                                    <div className="flex space-x-2 w-full items-center">
                                                        <img src={`/flags/${iso}.svg`} alt="flag" className="flex w-3 h-2" />
                                                        <span>{country}</span>
                                                    </div>
                                                    <span className="text-muted-foreground font-medium w-fit text-nowrap justify-end">{code}</span>
                                                </div>
                                            </CommandItem>
                                        )
                                    })
                                }</CommandList>
                            </Command>
                        </PopoverContent>
                    </Popover>
                </InputGroupAddon>

                <InputGroupInput
                    {...field}
                    type="tel"
                    className="w-full"
                    autoComplete="off"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    disabled={props.isPending}
                    placeholder={countryCodes.find((data) => data.country === country)?.placeholder}
                />
            </InputGroup>
        )}</Base>
    }