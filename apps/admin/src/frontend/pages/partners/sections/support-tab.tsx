"use client"

import { useQuery } from "@tanstack/react-query"
import { IconLockOpen, IconShieldLock } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"
import { Spinner } from "@workspace/ui/components/spinner"
import { Mono } from "@workspace/ui/customs/list/table-cells"

import { useTRPC } from "@/backend/api/client"
import type { OrganizationProfile } from "@/frontend/pages/partners/sections/profile-overview"

/**
 * What support may read of a company's own loads, and only while that
 * company has opened the door (support_access_grant): reference, stage,
 * lane and dates — never the money, never the other companies' rows. The
 * database decides: without a live grant the query returns nothing, and
 * every read is written to the company's own activity log.
 */
export function SupportTab({ profile }: { profile: OrganizationProfile }) {
    const t = useTranslations("Admin.partners.profile.support")
    const f = useFormatter()
    const trpc = useTRPC()

    const grant = profile.supportAccess
    const query = useQuery(trpc.partners.supportLoads.queryOptions({ organizationId: profile.id }, { enabled: grant !== null }))

    const when = (date: Date) => f.dateTime(date, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })

    return (
        <div className="flex flex-col gap-4">
            <div className="bg-muted/40 flex items-center gap-3 rounded-xl px-4 py-3">
                {grant
                    ? <IconLockOpen className="size-5 shrink-0 text-amber-600 dark:text-amber-400" stroke={1.5} />
                    : <IconShieldLock className="text-muted-foreground size-5 shrink-0" stroke={1.5} />}
                <div className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium">
                        {grant ? t("open-until", { date: when(grant.expiresAt) }) : t("closed")}
                    </span>
                    <span className="text-muted-foreground text-xs">
                        {grant ? `${t("granted-by", { name: grant.grantedByName ?? "—" })} · ${grant.reason}` : t("closed-hint")}
                    </span>
                </div>
            </div>

            {grant && (
                query.isPending ? (
                    <div className="flex justify-center py-8"><Spinner className="size-5" /></div>
                ) : query.isError ? (
                    <p className="text-destructive text-sm">{t("load-failed")}</p>
                ) : query.data.length === 0 ? (
                    <p className="text-muted-foreground py-8 text-center text-sm">{t("no-loads")}</p>
                ) : (
                    <ul className="flex flex-col">
                        {query.data.map((load) => (
                            <li key={load.id} className="flex items-center gap-3 border-t py-2.5 text-[13px] first:border-t-0">
                                <Mono className="text-xs font-medium">{load.ref}</Mono>
                                <span className="min-w-0 flex-1 truncate">
                                    {load.origin} → {load.destination}
                                    {load.cargo && <span className="text-muted-foreground"> · {load.cargo}</span>}
                                </span>
                                <span className="text-muted-foreground hidden text-xs sm:inline">
                                    {load.expectedLoadingDate ? f.dateTime(load.expectedLoadingDate, { day: "2-digit", month: "short" }) : ""}
                                </span>
                                <Badge variant="secondary">{t(`status.${load.status}`)}</Badge>
                            </li>
                        ))}
                    </ul>
                )
            )}

            <p className="text-muted-foreground text-xs">{t("logged")}</p>
        </div>
    )
}
