"use client"

import { useCallback, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { IconPlus } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { isAuthorized } from "@workspace/auth/user-permissions"

import { Button } from "@workspace/ui/components/button"

import { useTRPC } from "@/backend/api/client"
import { PageHeader } from "@workspace/ui/customs/list/page-header"
import { useStaffRole } from "@/frontend/pages/kyc/sections/document-checklist"
import { SubscriptionDialog, type DialogSubject } from "@/frontend/pages/subscriptions/sections/subscription-dialog"
import { subscriptionsListInput } from "@/frontend/pages/subscriptions/types"

export function SubscriptionsHeaderView() {
    const t = useTranslations("Admin.subscriptions")
    const trpc = useTRPC()

    const searchParams = useSearchParams()
    const get = useCallback((key: string) => searchParams.get(key), [searchParams])

    // Same query the table runs, so the count rides the cache instead of a second read
    const { data } = useQuery(trpc.subscriptions.list.queryOptions(subscriptionsListInput(get)))

    const canEdit = isAuthorized(useStaffRole(), "subscription", ["update"])
    const [subject, setSubject] = useState<DialogSubject>(null)

    return (
        <>
            <PageHeader
                eyebrow={[t("eyebrow"), t("title")]}
                title={t("title")}
                count={data?.counts.all}
                description={t("description")}
                search={{ placeholder: t("search"), clearLabel: t("clear") }}
                actions={canEdit ? (
                    <Button onClick={() => setSubject("new")}>
                        <IconPlus className="size-4" stroke={1.5} />
                        {t("add")}
                    </Button>
                ) : undefined}
            />

            <SubscriptionDialog subject={subject} onOpenChange={() => setSubject(null)} />
        </>
    )
}
