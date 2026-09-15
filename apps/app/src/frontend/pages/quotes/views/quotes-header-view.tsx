"use client"

import { useState } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { IconPlus } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"

import { useTRPC } from "@/backend/api/client"
import { PageHeader } from "@workspace/ui/customs/list/page-header"
import { NewQuoteSheet } from "@/frontend/pages/quotes/sections/new-quote-sheet"

/**
 * The top of the quotes page. The same table read from either side, so the
 * heading is the one thing that has to change: a carrier is looking at what
 * it sent, a client at what it was sent — and only the carrier has anything
 * to add here.
 */
export function QuotesHeaderView() {
    const t = useTranslations("App.quotes")
    const trpc = useTRPC()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const { data: stats } = useSuspenseQuery(trpc.quotes.stats.queryOptions())

    const [creating, setCreating] = useState(false)

    const orgType = session.organization.type

    return (
        <>
            <PageHeader
                title={t(`title.${orgType}`)}
                count={stats.byStatus.sent}
                description={t(`description.${orgType}`)}
                search={{
                    placeholder: t("search.placeholder"),
                    clearLabel: t("search.clear"),
                }}
                actions={
                    orgType === "carrier" ? (
                        <Button onClick={() => setCreating(true)}>
                            <IconPlus className="size-4" stroke={1.5} />
                            {t("add.trigger")}
                        </Button>
                    ) : undefined
                }
            />

            {orgType === "carrier" && <NewQuoteSheet open={creating} onOpenChange={setCreating} />}
        </>
    )
}
