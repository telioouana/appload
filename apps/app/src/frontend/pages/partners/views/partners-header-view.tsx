"use client"

import { useState } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { IconPlus } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import type { ConnectionRelation } from "@workspace/db/connections"

import { Button } from "@workspace/ui/components/button"

import { useTRPC } from "@/backend/api/client"
import { PageHeader } from "@workspace/ui/customs/list/page-header"
import { PartnersTabs } from "@/frontend/pages/partners/components/partner-tabs"
import { AddPartnerDialog } from "@/frontend/pages/partners/sections/add-partner-dialog"
import { countForKind, relationForKind, relationsFor, type PartnerListKind } from "@/frontend/pages/partners/types"

/**
 * The top of a partners list: what it holds, the links to the organization's
 * other lists, the search that narrows it and the one action that adds to it.
 */
export function PartnersHeaderView({ kind }: { kind: PartnerListKind }) {
    const t = useTranslations("App.partners")
    const trpc = useTRPC()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const { data: stats } = useSuspenseQuery(trpc.partners.stats.queryOptions())

    const [adding, setAdding] = useState(false)

    const orgType = session.organization.type

    return (
        <>
            <PageHeader
                eyebrow={[t("title"), t(`titles.${kind}`)]}
                title={t(`titles.${kind}`)}
                count={countForKind(orgType, kind, stats)}
                description={t(`description.${orgType}`)}
                search={{
                    placeholder: t("search.placeholder"),
                    clearLabel: t("search.clear"),
                }}
                below={<PartnersTabs orgType={orgType} kind={kind} stats={stats} />}
                actions={
                    <Button onClick={() => setAdding(true)}>
                        <IconPlus className="size-4" stroke={1.5} />
                        {t("add.trigger")}
                    </Button>
                }
            />

            {/* Adding from a list starts on that list's relation; the
                requests list holds both, so it starts on the first */}
            <AddPartnerDialog
                orgType={orgType}
                initialRelation={relationForKind(orgType, kind) ?? (relationsFor(orgType)[0] as ConnectionRelation)}
                open={adding}
                onOpenChange={setAdding}
            />
        </>
    )
}
