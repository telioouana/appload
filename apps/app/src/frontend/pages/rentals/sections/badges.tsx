"use client"

import { useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"

import type { ContractRole, ContractState, RentalRow } from "@/frontend/pages/rentals/types"

/** Where the rental stands; the same colours as a multi-trip order's chip. */
const STATE_CLASS: Record<ContractState, string> = {
    draft: "text-muted-foreground",
    proposed: "border-sky-500/40 text-sky-600 dark:text-sky-400",
    active: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
    exhausted: "border-amber-500/40 text-amber-600 dark:text-amber-400",
    expired: "border-orange-500/40 text-orange-600 dark:text-orange-400",
    closed: "",
}

export function RentalStateChip({ state }: { state: ContractState }) {
    const t = useTranslations("App.rentals.states")

    return (
        <Badge variant="outline" className={cn("rounded-full font-normal", STATE_CLASS[state])}>
            {t(state)}
        </Badge>
    )
}

/** Who the reader is to the rental: its owner, its client, or a transporter with a truck on it. */
export function RentalRoleChip({ role }: { role: ContractRole }) {
    const t = useTranslations("App.rentals.role")

    return (
        <Badge variant="outline" className="rounded-full font-normal">
            {t(role)}
        </Badge>
    )
}

const RED = "border-red-500/40 text-red-600 dark:text-red-400"
const AMBER = "border-amber-500/40 text-amber-600 dark:text-amber-400"

/** What asks for a hand today: disputed days, a driver who said no, one who did not answer. */
export function AttentionChips({ attention }: { attention: RentalRow["attention"] }) {
    const t = useTranslations("App.rentals.values")

    const chips = [
        attention.disputed > 0 && { key: "disputed", label: t("disputed", { count: attention.disputed }), className: RED },
        attention.saidNo > 0 && { key: "no", label: t("today-no"), className: RED },
        attention.silent > 0 && { key: "silent", label: t("today-silent"), className: AMBER },
    ].filter((chip) => chip !== false)

    if (chips.length === 0) return null

    return (
        <div className="flex flex-wrap gap-1">
            {chips.map((chip) => (
                <Badge key={chip.key} variant="outline" className={cn("rounded-full text-[11px] font-normal", chip.className)}>
                    {chip.label}
                </Badge>
            ))}
        </div>
    )
}
