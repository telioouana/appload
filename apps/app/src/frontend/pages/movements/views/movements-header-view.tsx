"use client"

import { IconPlus } from "@tabler/icons-react"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { PageHeader } from "@workspace/ui/customs/list/page-header"

import { useTRPC } from "@/backend/api/client"
import { SectionLinks } from "@/frontend/pages/movements/components/section-links"
import { useNewLoad } from "@/frontend/pages/movements/hooks/use-new-load"
import type { MovementScope, MovementSection } from "@/frontend/pages/movements/types"

/**
 * The top of either list: which section is open, how many loads it holds,
 * the search box, and the one thing to do here — file another load of this
 * list's shape. The sheet itself is the rail's; this only opens it.
 */
export function MovementsHeaderView({ scope, section }: { scope: MovementScope; section: MovementSection }) {
    const t = useTranslations("App.loads")
    const trpc = useTRPC()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    // The section counts for the tabs and the title pill, read from the same
    // stats the tiles show, so the two can never disagree
    const stats = useQuery(trpc.movements.stats.queryOptions({ scope }))

    const { open } = useNewLoad()

    const orgType = session.organization.type

    return (
        <PageHeader
            eyebrow={[t(`scope.${scope}`), t(`sections.${section}`)]}
            title={section === "all" ? t(`titles.all-${scope}`) : t(`titles.${section}`)}
            count={stats.data?.bySection[section]}
            description={t(`description.${scope}.${orgType}`)}
            search={{
                placeholder: t("search.placeholder"),
                clearLabel: t("search.clear"),
            }}
            below={<SectionLinks scope={scope} section={section} stats={stats.data} />}
            actions={
                <Button onClick={() => open(scope === "trips" ? "own-fleet" : "partner")}>
                    <IconPlus className="size-4" stroke={1.5} />
                    {t(`actions.new.${scope}`)}
                </Button>
            }
        />
    )
}
