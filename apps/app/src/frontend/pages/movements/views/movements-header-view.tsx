"use client"

import { IconTruck, IconUsersGroup } from "@tabler/icons-react"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"
import { PageHeader } from "@workspace/ui/customs/list/page-header"

import { Link } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { sectionHref, tabLabelKey } from "@/frontend/pages/movements/components/section-links"
import { MOVEMENT_SCOPES, type MovementScope, type MovementSection } from "@/frontend/pages/movements/types"

/**
 * The top of the list: which section is open, how many loads it holds on
 * the tab on screen, the search box, and the two tabs — the company's own
 * trucks and its partners' — each a link to the same section on the other
 * side, with that side's count. The section itself is the rail's; filing a
 * load is the rail's button too.
 */
export function MovementsHeaderView({ scope, section }: { scope: MovementScope; section: MovementSection }) {
    const t = useTranslations("App.loads")
    const trpc = useTRPC()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    // One count per tab, read from the same stats the tiles show, so the
    // pills, the title and the tiles can never disagree
    const trips = useQuery(trpc.movements.stats.queryOptions({ scope: "trips" }))
    const orders = useQuery(trpc.movements.stats.queryOptions({ scope: "orders" }))

    const orgType = session.organization.type
    const statsOf = (value: MovementScope) => (value === "trips" ? trips : orders).data

    return (
        <PageHeader
            eyebrow={[t("eyebrow"), t(`sections.${section}`)]}
            title={t(`titles.${section}`)}
            count={statsOf(scope)?.bySection[section]}
            description={t(`description.${scope}.${orgType}`)}
            search={{
                placeholder: t("search.placeholder"),
                clearLabel: t("search.clear"),
            }}
            below={
                // The two tabs are the one query param the section keeps, so
                // this is a pair of links like the fleet's kinds: each is
                // addressable, and a shared URL opens the side the sender saw
                <div role="tablist" className="bg-muted mt-2 flex w-fit gap-0.5 rounded-full p-1">
                    {MOVEMENT_SCOPES.map((value) => {
                        const active = value === scope
                        const Icon = value === "trips" ? IconTruck : IconUsersGroup
                        const count = statsOf(value)?.bySection[section]

                        return (
                            <Link
                                key={value}
                                role="tab"
                                aria-selected={active}
                                href={sectionHref(value, section)}
                                className={cn(
                                    "text-muted-foreground flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors",
                                    active && "bg-background text-foreground font-medium shadow-sm",
                                )}
                            >
                                <Icon className="size-3.5" stroke={1.5} />
                                {t(`tabs.${tabLabelKey(value, orgType)}`)}
                                {count !== undefined && (
                                    <span className={cn(
                                        "bg-background/60 text-muted-foreground rounded-full px-1.5 py-px text-[11px] leading-4 tabular-nums",
                                        active && "bg-primary/10 text-primary",
                                    )}>
                                        {count.toLocaleString()}
                                    </span>
                                )}
                            </Link>
                        )
                    })}
                </div>
            }
        />
    )
}
