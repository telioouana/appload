"use client"

import { useState } from "react"
import { IconArrowLeft, IconPencil, IconPlayerPlay, IconPlus, IconX } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"

import { Link } from "@/i18n/navigation"
import { useRentalMutations } from "@/frontend/pages/rentals/hooks/use-rental-mutations"
import { localDate } from "@/frontend/pages/rentals/lib/dates"
import { RentalRoleChip, RentalStateChip } from "@/frontend/pages/rentals/sections/badges"
import { AddLineDialog } from "@/frontend/pages/rentals/sections/lines-card"
import { RentalSheet } from "@/frontend/pages/rentals/sections/rental-sheet"
import type { RentalDetail } from "@/frontend/pages/rentals/types"
import { place } from "@/frontend/pages/movements/components/badges"

/**
 * The top of a rental's page: the way back to the tab it sits in, what it
 * is and where it stands, who is on the other side of it for the reader,
 * how far into the period it is, and what the reader can do about it now.
 */
export function RentalHeader({ rental }: { rental: RentalDetail }) {
    const t = useTranslations("App.rentals")
    const tl = useTranslations("App.loads")
    const f = useFormatter()
    const { transition } = useRentalMutations()

    const [editing, setEditing] = useState(false)
    const [adding, setAdding] = useState(false)
    const [closing, setClosing] = useState(false)

    const owner = rental.role === "owner"
    const { permissions } = rental

    const party = owner ? rental.client?.name : rental.owner.name
    const date = (iso: string) => f.dateTime(localDate(iso), { dateStyle: "medium" })
    const period = rental.endsOn === null
        ? t("values.since", { date: date(rental.startsOn) })
        : `${date(rental.startsOn)} – ${date(rental.endsOn)}`

    // "Day N of M" reads off the first line; the billable count is the whole rental's
    const first = rental.lines[0]
    const progress = first && rental.periodDays !== null && first.projectedDays !== null
        ? t("detail.progress-of", { today: first.days.length, total: first.projectedDays, billable: rental.billableDays })
        : t("detail.progress", { billable: rental.billableDays })

    const move = (to: "active" | "closed") => transition.mutate({ id: rental.id, to, expectedVersion: rental.version })

    return (
        <>
            <header className="flex flex-col gap-4 px-2 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                    <Button asChild size="icon" variant="outline" aria-label={t("title")} className="mt-4 shrink-0">
                        <Link href={{ pathname: "/orders/[section]", params: { section: "all" }, query: { tab: owner ? "own" : "partners" } }}>
                            <IconArrowLeft className="size-4" stroke={1.5} />
                        </Link>
                    </Button>

                    <div className="flex min-w-0 flex-col gap-1">
                        <nav className="text-muted-foreground flex items-center gap-1.5 text-xs">
                            <span>{tl("eyebrow")}</span>
                            <span aria-hidden>/</span>
                            <span className="text-foreground/70">{tl("kinds.rental")}</span>
                        </nav>

                        <div className="flex flex-wrap items-center gap-2.5">
                            <h1 className="font-heading truncate font-mono text-2xl font-semibold tracking-tight">{rental.ref}</h1>
                            <RentalStateChip state={rental.state} />
                            {!owner && <RentalRoleChip role={rental.role} />}
                        </div>

                        <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-sm">
                            {party && (
                                <>
                                    <span className="truncate">{party}</span>
                                    <span aria-hidden>·</span>
                                </>
                            )}
                            <span className="truncate">{rental.site ? place(rental.site) : t("values.no-site")}</span>
                            <span aria-hidden>·</span>
                            <span className="truncate">{period}</span>
                        </p>

                        {rental.lines.length > 0 && <p className="text-sm font-medium tabular-nums">{progress}</p>}
                    </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2 lg:mt-6">
                    {permissions.canAddLine && (
                        <Button size="sm" onClick={() => setAdding(true)}>
                            <IconPlus className="size-4" stroke={1.5} />
                            {t("detail.actions.add-line")}
                        </Button>
                    )}

                    {permissions.canAccept && (
                        <Button size="sm" disabled={transition.isPending} onClick={() => move("active")}>
                            {t("detail.actions.accept")}
                        </Button>
                    )}
                    {permissions.canDecline && (
                        <Button size="sm" variant="outline" disabled={transition.isPending} onClick={() => move("closed")}>
                            {t("detail.actions.decline")}
                        </Button>
                    )}
                    {permissions.canActivate && (
                        <Button size="sm" variant="outline" disabled={transition.isPending} onClick={() => move("active")}>
                            <IconPlayerPlay className="size-4" stroke={1.5} />
                            {t("detail.actions.activate")}
                        </Button>
                    )}

                    {permissions.canEdit && (
                        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                            <IconPencil className="size-4" stroke={1.5} />
                            {t("detail.actions.edit")}
                        </Button>
                    )}

                    {permissions.canClose && (
                        <Button size="sm" variant="ghost" onClick={() => setClosing(true)}>
                            <IconX className="size-4" stroke={1.5} />
                            {t("detail.actions.close")}
                        </Button>
                    )}
                </div>
            </header>

            {permissions.canEdit && <RentalSheet open={editing} onOpenChange={setEditing} mode={{ kind: "edit", rental }} />}

            {adding && <AddLineDialog rental={rental} onClose={() => setAdding(false)} />}

            {permissions.canClose && (
                <AlertDialog open={closing} onOpenChange={setClosing}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>{t("detail.actions.close")}</AlertDialogTitle>
                            <AlertDialogDescription>{t("detail.actions.close-confirm")}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>{t("form.cancel")}</AlertDialogCancel>
                            <AlertDialogAction disabled={transition.isPending} onClick={() => move("closed")}>
                                {t("detail.actions.close")}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
        </>
    )
}
