"use client"

import useOnclickOutside from "react-cool-onclickoutside";

import { useEffect, useState } from "react";
import { IconMapPin } from "@tabler/icons-react";

import type { PlaceAutocompleteResult } from "@googlemaps/google-maps-services-js";

import { Base } from "@workspace/ui/inputs/base";
import { ControlFunc } from "@workspace/ui/inputs/types";
import { Command, CommandItem, CommandList } from "@workspace/ui/components/command";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@workspace/ui/components/input-group";

import { autoComplete } from "@workspace/ui/lib/google";
import { useDebouncedValue } from "@workspace/ui/hooks/use-debounced-value";

export const LocationInput: ControlFunc<{
    setCountry?: (value: string) => void
    setPlaceId?: (value: string) => void
    setState?: (value: string) => void
}> = ({
    setCountry,
    setPlaceId,
    setState,
    ...props
}) => {
        const [places, setPlaces] = useState<PlaceAutocompleteResult[] | []>([])
        const [place, setPlace] = useState<string>("")

        const debouncedPlace = useDebouncedValue(place, 500)

        useEffect(() => {
            if (!debouncedPlace) {
                return
            }

            let cancelled = false

            autoComplete(debouncedPlace).then((suggestions) => {
                // A newer query superseded this request while it was in flight
                if (!cancelled) {
                    setPlaces(suggestions ?? [])
                }
            })

            return () => { cancelled = true }
        }, [debouncedPlace])

        const ref = useOnclickOutside(() => {
            setPlaces([]);
            setPlace("");
        });

        return (
            <Base {...props}>
                {(field) => {
                    function handleChange(input: string) {
                        setPlace(input)
                        field.onChange(input)
                    }

                    function handleSelect(suggestion: PlaceAutocompleteResult) {
                        field.onChange(suggestion.description)
                        const terms = suggestion.terms
                        const country = terms[terms.length - 1]
                        const state = terms[terms.length - 2]
                        if (country) setCountry?.(country.value)
                        if (state) setState?.(state.value)
                        setPlaceId?.(suggestion.place_id)
                        setPlaces([])
                        setPlace("")
                    }

                    return (
                        <div className="flex flex-col w-full relative" ref={ref}>
                            <InputGroup>
                                <InputGroupInput
                                    {...field}
                                    type="text"
                                    className="w-full"
                                    autoComplete="off"
                                    value={field.value ?? ""}
                                    disabled={props.isPending}
                                    placeholder={props.placeholder}
                                    onChange={(e) => handleChange(e.target.value)}
                                />

                                <InputGroupAddon>
                                    <InputGroupText><IconMapPin /></InputGroupText>
                                </InputGroupAddon>
                            </InputGroup>

                            {places.length > 0 && (
                                <Command className="absolute top-10 z-20 h-auto max-h-60 overflow-y-scroll container-snap w-full rounded-sm mt-2 bg-popover text-popover-foreground shadow-md outline-none p-1">
                                    <CommandList>
                                        {places.map((suggestion, index) => (
                                            <CommandItem
                                                className=""
                                                key={index}
                                                value={suggestion.description}
                                                onSelect={() => handleSelect(suggestion)}
                                            >{suggestion.description}</CommandItem>
                                        ))}
                                    </CommandList>
                                </Command>
                            )}
                        </div>

                    )
                }}
            </Base>
        )
    }