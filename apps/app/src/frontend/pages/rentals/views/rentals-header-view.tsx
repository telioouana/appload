"use client"

import { useCallback, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { IconCalendarTime, IconPlus, IconUsersGroup } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { isOrgAuthorized } from "@workspace/auth/organization-permissions"

import { Button } from "@workspace/ui/components/button"
import { PageHeader } from "@workspace/ui/customs/list/page-header"
import { cn } from "@workspace/ui/lib/utils"

import { Link } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { RentalSheet } from "@/frontend/pages/rentals/sections/rental-sheet"
import { RENTAL_TABS, rentalsListInput, type RentalTab } from "@/frontend/pages/rentals/types"

/**
 * The top of the rentals list: the title with the count of the tab on
 * screen, the search box, and the two tabs — the rentals in the company's
 * own books and the ones its partners named it on — each a link with that
 * side's count. Filing a rental is the manager's; the server refuses
 * anybody else, the button just does not tempt them.
 */
export function RentalsHeaderView() {
    const t = useTranslations("App.rentals")
    const trpc = useTRPC()
    const searchParams = useSearchParams()

    const get = useCallback((key: string) => searchParams.get(key), [searchParams])
    const { tab } = rentalsListInput(get)

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    // One count per tab, read from the same stats the tiles show, so the
    // pills, the title and the tiles can never disagree
    const own = useQuery(trpc.rentals.stats.queryOptions({ tab: "own" }))
    const partners = useQuery(trpc.rentals.stats.queryOptions({ tab: "partners" }))

    const [creating, setCreating] = useState(false)

    const orgType = session.organization.type
    const canCreate = isOrgAuthorized(session.role, "contract", ["create"])
    const statsOf = (value: RentalTab) => (value === "own" ? own : partners).data

    return (
        <>
            <PageHeader
                title={t("title")}
                count={statsOf(tab)?.total}
                description={t(`description.${orgType}`)}
                search={{
                    placeholder: t("search.placeholder"),
                    clearLabel: t("search.clear"),
                }}
                actions={
                    canCreate ? (
                        <Button onClick={() => setCreating(true)}>
                            <IconPlus className="size-4" stroke={1.5} />
                            {t("add.trigger")}
                        </Button>
                    ) : undefined
                }
                below={
                    // The two tabs are one query param, so this is a pair of
                    // links: each is addressable, and a shared URL opens the
                    // side the sender saw. The rest of the query is dropped —
                    // the states counted on one side mean nothing on the other
                    <div role="tablist" className="bg-muted mt-2 flex w-fit gap-0.5 rounded-full p-1">
                        {RENTAL_TABS.map((value) => {
                            const active = value === tab
                            const Icon = value === "own" ? IconCalendarTime : IconUsersGroup
                            const count = statsOf(value)?.total

                            return (
                                <Link
                                    key={value}
                                    role="tab"
                                    aria-selected={active}
                                    href={{ pathname: "/orders/[section]", params: { section: "rental" }, query: { tab: value } }}
                                    className={cn(
                                        "text-muted-foreground flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors",
                                        active && "bg-background text-foreground font-medium shadow-sm",
                                    )}
                                >
                                    <Icon className="size-3.5" stroke={1.5} />
                                    {t(`tabs.${value}`)}
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

            {canCreate && <RentalSheet open={creating} onOpenChange={setCreating} mode={{ kind: "create" }} />}
        </>
    )
}
