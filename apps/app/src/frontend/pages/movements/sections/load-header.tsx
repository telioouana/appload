"use client"

import { IconArrowLeft } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

import type { TrackingAllowance } from "@workspace/domain/subscription"

import { Link } from "@/i18n/navigation"
import { ExecutionChip, MovementStatusChip, RoleChip, place } from "@/frontend/pages/movements/components/badges"
import { sectionHref } from "@/frontend/pages/movements/components/section-links"
import { LoadActions } from "@/frontend/pages/movements/sections/load-actions"
import { scopeOf, sectionOf, type MovementDetail, type OrgType } from "@/frontend/pages/movements/types"

/**
 * The top of a load's page: the way back to the list it sits in, what the
 * load is, who is on the other side of it for the reader, and the things
 * the reader can do about it now.
 */
export function LoadHeader({
    load,
    orgType,
    allowance,
    organizationName,
}: {
    load: MovementDetail
    orgType: OrgType
    allowance: TrackingAllowance
    organizationName: string
}) {
    const t = useTranslations("App.loads")

    const scope = scopeOf(load)
    const section = sectionOf(load)

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
                        <span>{t(`scope.${scope}`)}</span>
                        <span aria-hidden>/</span>
                        <span className="text-foreground/70">{t(`sections.${section}`)}</span>
                    </nav>

                    <div className="flex flex-wrap items-center gap-2.5">
                        <h1 className="font-heading truncate text-2xl font-semibold tracking-tight">{load.ref}</h1>
                        <MovementStatusChip status={load.status} execution={load.execution} />
                        {load.role === "owner" ? <ExecutionChip execution={load.execution} /> : <RoleChip role={load.role} />}
                        {/* How much of the load is still to be filled in; the cards below say what */}
                        {load.flags.length > 0 && (
                            <Badge variant="outline" className="border-destructive/40 text-destructive rounded-full font-normal">
                                {t("header.flags", { count: load.flags.length })}
                            </Badge>
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

            <div className="shrink-0 lg:mt-6">
                <LoadActions load={load} orgType={orgType} allowance={allowance} organizationName={organizationName} />
            </div>
        </header>
    )
}
