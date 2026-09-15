"use client"

import { useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { Link } from "@/i18n/navigation"
import { Scroller } from "@workspace/ui/customs/list/scroller"
import { sectionsFor, type OrderSection, type OrderStats, type OrgType } from "@/frontend/pages/orders/types"

/**
 * The sections, as tabs. They are routes rather than a URL filter — each one
 * is addressable, and a shared link opens the list the sender meant — so
 * these are links, not buttons, and following one starts the section clean
 * instead of carrying the previous page's search into it.
 *
 * Which sections exist depends on the organization type: a carrier has no
 * "all", because an order it was never asked about is not its business.
 */
export function SectionTabs({
    section,
    orgType,
    stats,
}: {
    section: OrderSection
    orgType: OrgType
    stats: OrderStats | undefined
}) {
    const t = useTranslations("App.orders.sections")

    return (
        // The strip sits on the page ground rather than on a card, so the
        // scroll fades are painted in that colour instead of the card's
        <Scroller axis="x" className="mt-2" fadeClassName="from-background to-background/0">
            <div role="tablist" className="flex w-max gap-0.5">
                {sectionsFor(orgType).map((value) => {
                    const active = value === section
                    const count = stats?.bySection[value]

                    return (
                        <Link
                            key={value}
                            role="tab"
                            aria-selected={active}
                            href={{ pathname: "/appload/[section]", params: { section: value } }}
                            className={cn(
                                "text-muted-foreground hover:text-foreground flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] whitespace-nowrap transition-colors",
                                active && "bg-primary/10 text-primary font-medium",
                            )}
                        >
                            {t(value)}
                            {count !== undefined && (
                                <span className={cn(
                                    "bg-muted text-muted-foreground rounded-full px-1.5 py-px text-[11px] leading-4 tabular-nums",
                                    active && "bg-primary/15 text-primary",
                                )}>
                                    {count.toLocaleString()}
                                </span>
                            )}
                        </Link>
                    )
                })}
            </div>
        </Scroller>
    )
}
