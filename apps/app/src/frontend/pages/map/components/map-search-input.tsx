"use client"

import { useState } from "react"
import { IconSearch, IconX } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@workspace/ui/components/input-group"

/**
 * The map's search box, shared by the list beside the map and the table
 * view's toolbar. Typing stays local so each keystroke re-renders the box,
 * not the map; the trimmed text goes to `?q=` through `onQueryChange`.
 */
export function MapSearchInput({
    query,
    onQueryChange,
    className,
}: {
    query: string
    onQueryChange: (value: string) => void
    className?: string
}) {
    const t = useTranslations("App.map")

    const [text, setText] = useState(query)

    // `?q=` can also change from outside the box — back/forward rewrites it.
    // Adjusting the state during render is React's own answer to that (an
    // effect would render the stale text once and then render again).
    // `lastQuery` is the previous value of the prop, so this only fires on a
    // real external change.
    const [lastQuery, setLastQuery] = useState(query)

    if (query !== lastQuery) {
        setLastQuery(query)

        // Typing writes the trimmed text to the URL, so "beira " coming back
        // as "beira" is our own echo, not somebody else's edit.
        if (text.trim() !== query) setText(query)
    }

    const update = (value: string) => {
        setText(value)
        onQueryChange(value)
    }

    return (
        <InputGroup className={className}>
            <InputGroupAddon>
                <IconSearch className="size-4" stroke={1.5} />
            </InputGroupAddon>

            <InputGroupInput
                value={text}
                placeholder={t("search")}
                onChange={(event) => update(event.target.value)}
            />

            {text && (
                <InputGroupAddon align="inline-end">
                    <InputGroupButton
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t("clear-search")}
                        onClick={() => update("")}
                    >
                        <IconX className="size-4" stroke={1.5} />
                    </InputGroupButton>
                </InputGroupAddon>
            )}
        </InputGroup>
    )
}
