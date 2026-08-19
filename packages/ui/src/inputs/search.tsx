"use client"

import useOnclickOutside from "react-cool-onclickoutside";

import { withMask } from "use-mask-input";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { IconLoader2, IconPlus, IconSearch } from "@tabler/icons-react";

import { Base } from "@workspace/ui/inputs/base";
import { ControlFunc } from "@workspace/ui/inputs/types";
import { DEFAULT_DEBOUNCE, useDebouncedValue } from "@workspace/ui/hooks/use-debounced-value";
import { Command, CommandItem, CommandList } from "@workspace/ui/components/command";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@workspace/ui/components/input-group";

export type SearchOption = {
    id: string;
    label: string;
};

export type SearchRegisterProps = {
    /** The trimmed query at the moment the register row was picked */
    query: string;
    /** Whether the registration flow should be shown */
    open: boolean;
    /** Dismiss the registration flow without selecting */
    close: () => void;
    /** Write the newly registered option into the field and select it */
    apply: (option: SearchOption) => void;
};

/**
 * Type-to-search input rendering suggestions in a Command list dropdown
 * (mouse friendly — same pattern as LocationInput). The bound form field
 * holds the option label; the matched option is reported through
 * `onSelect`, cleared whenever the text stops matching a selection. The
 * search itself is owned by the caller: it feeds `options` and reacts to
 * `onQueryChange`, keeping this component backend-agnostic.
 *
 * `renderRegister` optionally renders an inline registration flow (e.g. a
 * dialog) shown when a non-empty query has no matches.
 *
 * Typing is debounced before `onQueryChange` fires (`debounce` ms, 300 by
 * default), so callers can query their backend directly without their own
 * debouncing.
 */
export const SearchInput: ControlFunc<{
    options: SearchOption[];
    isLoading?: boolean;
    disabled?: boolean;
    debounce?: number;
    loadingText?: string;
    emptyText?: string;
    registerText?: (query: string) => string;
    /** Optional input mask (use-mask-input), e.g. "AAA 999 AA" for plates */
    inputMask?: string;
    onQueryChange: (text: string) => void;
    onSelect: (option?: SearchOption) => void;
    renderRegister?: (props: SearchRegisterProps) => React.ReactNode;
    /** Trailing content for each result row, e.g. a status badge */
    renderOption?: (option: SearchOption) => React.ReactNode;
}> = ({
    options,
    isLoading,
    disabled,
    debounce = DEFAULT_DEBOUNCE,
    loadingText,
    emptyText,
    registerText,
    inputMask,
    onQueryChange,
    onSelect,
    renderRegister,
    renderOption,
    ...props
}) => {
        const [open, setOpen] = useState(false)
        const [query, setQuery] = useState("")
        const [registering, setRegistering] = useState(false)

        // Guards against the input echo that follows a selection clearing the match
        const selectedLabel = useRef<string | null>(null)

        const ref = useOnclickOutside(() => setOpen(false));

        // Emit the query only once typing settles; the effect event sees the
        // latest callback without retriggering the effect
        const emit = useEffectEvent((value: string) => onQueryChange(value))

        const debouncedQuery = useDebouncedValue(query, debounce)

        useEffect(() => {
            emit(debouncedQuery)
        }, [debouncedQuery])

        const trimmedQuery = query.trim()
        const isWaiting = Boolean(isLoading) || trimmedQuery !== debouncedQuery.trim()
        const showRegister = Boolean(renderRegister && registerText)
            && !isWaiting && trimmedQuery.length > 0 && options.length === 0

        return (
            <Base {...props}>
                {(field) => {
                    function handleChange(text: string) {
                        field.onChange(text)
                        setQuery(text)
                        setOpen(true)

                        // Typing something else invalidates the previous match
                        if (text !== selectedLabel.current) {
                            onSelect(undefined)
                        }
                    }

                    function handleSelect(option: SearchOption) {
                        selectedLabel.current = option.label
                        field.onChange(option.label)
                        onSelect(option)
                        setQuery(option.label)
                        setOpen(false)
                    }

                    return (
                        <div className="flex flex-col w-full relative" ref={ref}>
                            <InputGroup>
                                <InputGroupInput
                                    {...field}
                                    type="text"
                                    className="w-full"
                                    autoComplete="off"
                                    ref={inputMask
                                        ? withMask(inputMask, { placeholder: "_", showMaskOnHover: false })
                                        : undefined}
                                    value={field.value ?? ""}
                                    disabled={props.isPending || disabled}
                                    placeholder={props.placeholder}
                                    aria-invalid={field["aria-invalid"]}
                                    onFocus={() => setOpen(true)}
                                    onClick={() => setOpen(true)}
                                    onChange={(e) => handleChange(e.target.value)}
                                />

                                <InputGroupAddon>
                                    <InputGroupText>
                                        {isWaiting ? <IconLoader2 className="animate-spin" /> : <IconSearch />}
                                    </InputGroupText>
                                </InputGroupAddon>
                            </InputGroup>

                            {open && !disabled && (options.length > 0 || isWaiting || trimmedQuery.length > 0) && (
                                <Command
                                    shouldFilter={false}
                                    className="absolute top-10 z-20 h-auto max-h-60 overflow-y-scroll container-snap w-full rounded-sm mt-2 bg-popover text-popover-foreground shadow-md outline-none p-1"
                                >
                                    <CommandList>
                                        {options.map((option) => (
                                            <CommandItem
                                                key={option.id}
                                                value={option.id}
                                                onSelect={() => handleSelect(option)}
                                                className="gap-2"
                                            >
                                                <span className="truncate">{option.label}</span>
                                                {/* Lets a caller hang state on the row —
                                                    a verification badge, a warning — without
                                                    this component knowing what it means */}
                                                {renderOption?.(option)}
                                            </CommandItem>
                                        ))}

                                        {showRegister && (
                                            <CommandItem
                                                value="__register__"
                                                onSelect={() => setRegistering(true)}
                                            >
                                                <IconPlus />
                                                {registerText!(trimmedQuery)}
                                            </CommandItem>
                                        )}

                                        {!showRegister && options.length === 0 && (
                                            <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                {isWaiting ? loadingText : emptyText}
                                            </div>
                                        )}
                                    </CommandList>
                                </Command>
                            )}

                            {renderRegister?.({
                                query: trimmedQuery,
                                open: registering,
                                close: () => setRegistering(false),
                                apply: (option) => {
                                    handleSelect(option)
                                    setRegistering(false)
                                },
                            })}
                        </div>
                    )
                }}
            </Base>
        )
    }
