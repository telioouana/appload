"use client"

import { IconHistory } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"

import { HistoryTimeline, type HistoryEntry } from "@/frontend/pages/order/components/history-timeline"

/**
 * The order's full history, hung off the trip strip. The strip says where
 * the trip is now; this says how it got there — the same question one step
 * deeper — so it opens from the strip rather than taking a panel of its own.
 *
 * The timeline has no height of its own, so the popover caps itself against
 * whatever room Radix reports and scrolls inside that.
 */
export function ActivityPopover({ entries }: { entries: HistoryEntry[] }) {
    const t = useTranslations("Admin.orders.detailPage")

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="w-fit">
                    <IconHistory className="size-4" stroke={1.5} />
                    {t("sections.activity")}
                    <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-[11px] leading-4 tabular-nums">
                        {entries.length}
                    </span>
                </Button>
            </PopoverTrigger>

            <PopoverContent
                align="end"
                collisionPadding={12}
                className="container-snap max-h-[calc(var(--radix-popover-content-available-height)-8px)] w-96 overflow-y-auto"
            >
                <HistoryTimeline entries={entries} />
            </PopoverContent>
        </Popover>
    )
}
