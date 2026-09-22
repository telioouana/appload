"use client"

import { IconArrowLeft } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"

import type { TrackingAllowance } from "@workspace/domain/subscription"

import { Link } from "@/i18n/navigation"
import { ExecutionChip, MovementStatusChip, RoleChip, place, useFlagLabel } from "@/frontend/pages/movements/components/badges"
import { sectionHref, tabLabelKey } from "@/frontend/pages/movements/components/section-links"
import { LoadActions } from "@/frontend/pages/movements/sections/load-actions"
import { scopeOf, sectionOf, type MovementDetail, type OrgType } from "@/frontend/pages/movements/types"

/**
 * The top of a load's page: the way back to the section and tab it sits in
 * (`/orders/<section>?tab=own | partners`), what the load is, who is on the
 * other side of it for the reader, and the things the reader can do about
 * it now.
 */
export function LoadHeader({
    load,
    orgType,
    allowance,
    organizationName,
    actions = true,
}: {
    load: MovementDetail
    orgType: OrgType
    allowance: TrackingAllowance
    organizationName: string
    /** A load the company has not won yet has nothing to do but be quoted. */
    actions?: boolean
}) {
    const t = useTranslations("App.loads")
    const flagLabel = useFlagLabel()

    const scope = scopeOf(load)
    const section = sectionOf(load)

    const appload = load.appload
    // A company Appload is still asking has no reference of its own yet, so
    // the order's is what names the page
    const reference = appload?.role === "candidate" ? appload.orderId : load.ref

    // The other company on the load, from where the reader stands
    const party = load.role === "owner"
        ? (load.execution === "partner" ? load.carrier?.name : load.client?.name)
        : load.owner?.name

    return (
        <header className="flex flex-col gap-4 px-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
                <Button asChild size="icon" variant="outline" aria-label={t("detail.back")} className="mt-4 shrink-0">
                    <Link href={sectionHref(scope, section)}>
                        <IconArrowLeft className="size-4" stroke={1.5} />
                    </Link>
                </Button>

                <div className="flex min-w-0 flex-col gap-1">
                    <nav className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        <span>{t("eyebrow")}</span>
                        <span aria-hidden>/</span>
                        <span>{t(`tabs.${tabLabelKey(scope, orgType)}`)}</span>
                        <span aria-hidden>/</span>
                        <span className="text-foreground/70">{t(`sections.${section}`)}</span>
                    </nav>

                    <div className="flex flex-wrap items-center gap-2.5">
                        <h1 className="font-heading truncate text-2xl font-semibold tracking-tight">{reference}</h1>
                        <MovementStatusChip status={load.status} />
                        {/* Which Appload order the load follows, so the two
                            references can be read against each other */}
                        {appload && (
                            <Badge variant="outline" className="rounded-full font-normal">
                                {appload.role === "candidate"
                                    ? t("appload.partner")
                                    : t("appload.badge", { orderId: appload.orderId })}
                            </Badge>
                        )}
                        {load.role === "owner" ? <ExecutionChip execution={load.execution} /> : <RoleChip role={load.role} />}
                        {/* How much of the load is still to be filled in — named
                            right here, the same words the cards below use */}
                        {load.flags.length > 0 && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Badge tabIndex={0} variant="outline" className="border-destructive/40 text-destructive cursor-default rounded-full font-normal">
                                        {t("header.flags", { count: load.flags.length })}
                                    </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-64">
                                    {load.flags.map(flagLabel).join(" · ")}
                                </TooltipContent>
                            </Tooltip>
                        )}
                    </div>

                    <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-sm">
                        {party && (
                            <>
                                <span className="truncate">{party}</span>
                                <span aria-hidden>·</span>
                            </>
                        )}
                        <span className="truncate">{place(load.origin)} → {place(load.destination)}</span>
                        {load.cargoDescription && (
                            <>
                                <span aria-hidden>·</span>
                                <span className="max-w-80 truncate">{load.cargoDescription}</span>
                            </>
                        )}
                    </p>
                </div>
            </div>

            {actions && (
                <div className="shrink-0 lg:mt-6">
                    <LoadActions load={load} orgType={orgType} allowance={allowance} organizationName={organizationName} />
                </div>
            )}
        </header>
    )
}
