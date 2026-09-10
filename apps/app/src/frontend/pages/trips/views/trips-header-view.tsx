"use client"

import { useState } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { IconPlus } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"

import { useTRPC } from "@/backend/api/client"
import { PageHeader } from "@/components/list/page-header"
import { NewTripSheet } from "@/frontend/pages/trips/sections/new-trip-sheet"

/**
 * The top of the trips page. Both organization types watch loads the same
 * way, so there is one heading — and one thing to do here, which is to
 * register another movement.
 */
export function TripsHeaderView() {
    const t = useTranslations("App.trips")
    const trpc = useTRPC()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const { data: stats } = useSuspenseQuery(trpc.trips.stats.queryOptions())

    const [creating, setCreating] = useState(false)

    return (
        <>
            <PageHeader
                title={t("title")}
                count={stats.total}
                description={t("description")}
                search={{
                    placeholder: t("search.placeholder"),
                    clearLabel: t("search.clear"),
                }}
                actions={
                    <Button onClick={() => setCreating(true)}>
                        <IconPlus className="size-4" stroke={1.5} />
                        {t("add.trigger")}
                    </Button>
                }
            />

            <NewTripSheet
                open={creating}
                onOpenChange={setCreating}
                allowance={session.allowance}
                organizationName={session.organization.name}
            />
        </>
    )
}
