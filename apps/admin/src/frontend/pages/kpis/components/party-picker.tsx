"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { useSuspenseQuery } from "@tanstack/react-query"
import { IconChevronDown } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@workspace/ui/components/command"

import { useTRPC } from "@/backend/api/client"
import { useRouter } from "@/i18n/navigation"
import { carriedQuery, optionsInput } from "@/frontend/pages/kpis/types"

/**
 * Whose report the page is showing. The options are the partners with
 * transports in this period, busiest first — the same population the list
 * ranks — so the picker and the list can never offer different partners, and
 * a name that is not in the period is not in the list either. The trigger
 * shows @name, the report's own: the report is for whoever the URL names,
 * even a partner who moved nothing in this period and so is in no list.
 *
 * Where the two navigations go is the whole point of the nested route.
 * Swapping partners **replaces** the history entry, because Back belongs to
 * the list the report was opened from and not to the partner looked at before
 * this one; "Show all" pushes the list back, carrying the period along so it
 * opens on the same stretch the report was read over.
 */
export function PartyPicker({ name }: { name: string }) {
    const t = useTranslations("Admin.kpis")
    const f = useFormatter()
    const trpc = useTRPC()
    const router = useRouter()
    const searchParams = useSearchParams()

    const [open, setOpen] = useState(false)

    const get = (key: string) => searchParams.get(key)

    const { data: parties } = useSuspenseQuery(trpc.kpis.partyOptions.queryOptions(optionsInput(get)))

    const pick = (id: string) => {
        setOpen(false)
        router.replace({ pathname: "/kpis/[party]", params: { party: id }, query: carriedQuery(get) })
    }

    const showAll = () => {
        setOpen(false)
        router.push({ pathname: "/kpis", query: carriedQuery(get) })
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="max-w-56">
                    <span className="truncate">{name}</span>
                    <IconChevronDown className="size-3.5" stroke={1.5} />
                </Button>
            </PopoverTrigger>

            <PopoverContent align="end" className="w-80 p-0">
                {/* Searched by name, listed by id: two partners can share a
                    name, and cmdk needs each row to be its own value */}
                <Command className="rounded-3xl">
                    <CommandInput placeholder={t("party.search")} />
                    <CommandList>
                        <CommandEmpty>{t("party.none")}</CommandEmpty>
                        <CommandGroup>
                            {parties.map((row) => (
                                <CommandItem
                                    key={row.id}
                                    value={row.id}
                                    keywords={[row.name]}
                                    onSelect={() => pick(row.id)}
                                    className="gap-3"
                                >
                                    <span className="flex-1 truncate">{row.name}</span>
                                    <span className="text-muted-foreground text-xs">{f.number(row.transports)}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                        <CommandSeparator />
                        <CommandGroup>
                            <CommandItem value="__all" onSelect={showAll}>
                                {t("party.clear")}
                            </CommandItem>
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
