"use client"

import { useState } from "react"
import { IconCalendar } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Calendar } from "@workspace/ui/components/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"

import { useKpiParams } from "@/frontend/pages/kpis/hooks/use-kpi-params"
import { usePeriodLabel } from "@/frontend/pages/kpis/hooks/use-period-label"
import { toIsoDate } from "@/frontend/pages/kpis/types"

/** What the range calendar hands back, kept local so the page does not import its picker. */
type DayRange = { from: Date | undefined; to?: Date | undefined }

/** A `yyyy-mm-dd` day as the local midnight the calendar draws it on. */
const localDay = (day: string) =>
    new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))

/**
 * The custom period: two months of calendar, and nothing written until Apply.
 * A range is only half a range while the second end is being picked, and
 * writing that half to the URL would send the page off to fetch a report for
 * a single day on the way to the one that was wanted — so the draft lives in
 * local state, seeded each time the popover opens from the range on screen.
 *
 * Only rendered under the custom preset, so the trigger can borrow the shared
 * period label, which reads as the range itself there.
 */
export function RangePopover() {
    const t = useTranslations("Admin.kpis")
    const { period, setRange } = useKpiParams()

    const [open, setOpen] = useState(false)
    const [draft, setDraft] = useState<DayRange | undefined>(undefined)

    const label = usePeriodLabel(period)

    const apply = () => {
        if (!draft?.from || !draft.to) return

        // Local getters, never `toISOString`: the calendar hands back local
        // midnights, which UTC would push back a day east of Greenwich
        setRange(toIsoDate(draft.from), toIsoDate(draft.to))
        setOpen(false)
    }

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                if (next) setDraft({ from: localDay(period.from), to: localDay(period.to) })
                setOpen(next)
            }}
        >
            <PopoverTrigger asChild>
                {/* The label names the button and the range names the period:
                    a screen reader needs both, and an aria-label would hide
                    the visible one */}
                <Button variant="outline" size="sm" aria-label={`${t("period.pick-range")}: ${label}`}>
                    <IconCalendar className="size-4" stroke={1.5} />
                    {label}
                </Button>
            </PopoverTrigger>

            <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                    mode="range"
                    numberOfMonths={2}
                    captionLayout="dropdown"
                    defaultMonth={localDay(period.from)}
                    selected={draft}
                    onSelect={setDraft}
                />

                <div className="flex justify-end border-t p-2">
                    <Button size="sm" disabled={!draft?.from || !draft.to} onClick={apply}>
                        {t("period.apply")}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    )
}
