"use client"

import { useSearchParams } from "next/navigation"

import { useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { useListParams } from "@workspace/ui/hooks/use-list-params"
import { currentTab, tabsFor, type OrgType, type PartnerStats, type PartnerTab } from "@/frontend/pages/partners/types"

/**
 * The page's own slice of the connection table, under the title rather than
 * inside the list card: the requests tab is not a filter of the same rows,
 * it is a different thing to do.
 *
 * Switching tabs drops the page, the open profile, the ticked rows and the
 * direction tile — everything that only made sense for the list being left.
 */
export function PartnersTabs({ orgType, stats }: { orgType: OrgType; stats: PartnerStats }) {
    const t = useTranslations("App.partners.tabs")
    const searchParams = useSearchParams()
    const { set } = useListParams()

    const tabs = tabsFor(orgType)
    const active = currentTab((key) => searchParams.get(key), orgType)

    const count = (tab: PartnerTab) =>
        tab === "requests" ? stats.incoming + stats.outgoing
            : tab === "subcontractors" ? stats.accepted.subcontract
                : stats.accepted["client-carrier"]

    return (
        <div role="radiogroup" className="bg-muted mt-2 flex w-fit gap-0.5 rounded-full p-1">
            {tabs.map((tab) => {
                const selected = tab === active

                return (
                    <button
                        key={tab}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => set([
                            { key: "tab", value: tab === tabs[0] ? null : tab },
                            { key: "direction", value: null },
                            { key: "page", value: null },
                            { key: "id", value: null },
                            { key: "sel", value: null },
                        ])}
                        className={cn(
                            "text-muted-foreground flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors",
                            selected && "bg-background text-foreground font-medium shadow-sm",
                        )}
                    >
                        {t(tab)}
                        <span className={cn(
                            "text-muted-foreground rounded-full text-[11px] tabular-nums",
                            selected && "text-primary",
                        )}>
                            {count(tab).toLocaleString()}
                        </span>
                    </button>
                )
            })}
        </div>
    )
}
