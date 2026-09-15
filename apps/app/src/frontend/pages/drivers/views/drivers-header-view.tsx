"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { IconPlus } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"

import { useTRPC } from "@/backend/api/client"
import { PageHeader } from "@workspace/ui/customs/list/page-header"
import { RegisterDriverDialog } from "@/frontend/pages/drivers/sections/register-driver-dialog"

export function DriversHeaderView() {
    const t = useTranslations("App.drivers")
    const trpc = useTRPC()

    const [registerOpen, setRegisterOpen] = useState(false)

    // The record count for the title pill, from the same stats the tiles show
    const stats = useQuery(trpc.drivers.stats.queryOptions())

    return (
        <>
            <PageHeader
                eyebrow={[t("eyebrow"), t("title")]}
                title={t("title")}
                count={stats.data?.total}
                description={t("description")}
                search={{
                    placeholder: t("filters.search"),
                    clearLabel: t("filters.clear"),
                }}
                actions={
                    <Button onClick={() => setRegisterOpen(true)}>
                        <IconPlus className="size-4" stroke={1.5} />
                        {t("add")}
                    </Button>
                }
            />

            <RegisterDriverDialog open={registerOpen} onOpenChange={setRegisterOpen} />
        </>
    )
}
