"use client"

import { IconArrowDownLeft, IconArrowUpRight } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import type { KycStatus } from "@workspace/db/types"
import type { ConnectionRelation, ConnectionStatus } from "@workspace/db/connections"

import { Badge } from "@workspace/ui/components/badge"
import { StatusBadge, type StatusKey } from "@workspace/ui/customs/badge/status-badge"

import { partnerKind, type ConnectionDirection, type OrgType, type PartnerContractState } from "@/frontend/pages/partners/types"

/** Appload's verdict on the partner's paperwork — the same badge Admin shows. */
export function KycBadge({ status }: { status: KycStatus }) {
    const t = useTranslations("App.partners.kyc")

    return <StatusBadge label={t(status)} status={status} />
}

// The contract has no status vocabulary of its own — it is one KYC document —
// so each state borrows the tone of the verification state it amounts to:
// nothing on file reads the same as paperwork that was turned down.
const CONTRACT_TONE: Record<PartnerContractState, StatusKey> = {
    valid: "verified",
    pending: "pending-review",
    missing: "rejected",
    expired: "expired",
}

/** Whether the transporter has a valid signed contract with Appload. */
export function ContractChip({ state }: { state: PartnerContractState }) {
    const t = useTranslations("App.partners.profile.contract")

    return <StatusBadge label={t(state)} status={CONTRACT_TONE[state]} />
}

/** What the other company is to this one: client or transporter. */
export function RelationChip({ relation, orgType }: { relation: ConnectionRelation; orgType: OrgType }) {
    const t = useTranslations("App.partners.kind")

    return <Badge variant="outline" className="rounded-full font-normal">{t(partnerKind(orgType, relation))}</Badge>
}

/** Which side asked — the only thing that says whether a pending row is yours to answer. */
export function DirectionChip({ direction }: { direction: ConnectionDirection }) {
    const t = useTranslations("App.partners.direction")

    const Icon = direction === "incoming" ? IconArrowDownLeft : IconArrowUpRight

    return (
        <Badge variant="secondary" className="gap-1 rounded-full font-normal">
            <Icon className="size-3.5" stroke={1.5} />
            {t(direction)}
        </Badge>
    )
}

/** Where the connection stands; accepted rows carry it implicitly, so they show nothing. */
export function ConnectionStatusChip({ status }: { status: ConnectionStatus }) {
    const t = useTranslations("App.partners.status")

    if (status === "accepted") return null

    return <Badge variant="outline" className="rounded-full font-normal">{t(status)}</Badge>
}
