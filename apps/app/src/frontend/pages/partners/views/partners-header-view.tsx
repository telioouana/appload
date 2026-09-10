"use client"

import { useState } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { IconPlus } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"

import { useTRPC } from "@/backend/api/client"
import { PageHeader } from "@workspace/ui/customs/list/page-header"
import { PartnersTabs } from "@/frontend/pages/partners/components/partner-tabs"
import { AddPartnerDialog } from "@/frontend/pages/partners/sections/add-partner-dialog"

/**
 * The top of the partners page: what the list holds, the tabs that slice it,
 * the search that narrows it and the one action that adds to it.
 */
export function PartnersHeaderView() {
    const t = useTranslations("App.partners")
    const trpc = useTRPC()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const { data: stats } = useSuspenseQuery(trpc.partners.stats.queryOptions())

    const [adding, setAdding] = useState(false)

    const orgType = session.organization.type
    const connected = stats.accepted["client-carrier"] + stats.accepted.subcontract

    return (
        <>
            <PageHeader
                title={t("title")}
                count={connected}
                description={t(`description.${orgType}`)}
                search={{
                    placeholder: t("search.placeholder"),
                    clearLabel: t("search.clear"),
                }}
                below={<PartnersTabs orgType={orgType} stats={stats} />}
                actions={
                    <Button onClick={() => setAdding(true)}>
                        <IconPlus className="size-4" stroke={1.5} />
                        {t("add.trigger")}
                    </Button>
                }
            />

            <AddPartnerDialog orgType={orgType} open={adding} onOpenChange={setAdding} />
        </>
    )
}
