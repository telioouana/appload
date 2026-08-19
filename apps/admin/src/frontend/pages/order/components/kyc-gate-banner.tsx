"use client"

import { useQuery } from "@tanstack/react-query"
import { IconAlertTriangle, IconShieldExclamation } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"

import { useTRPC } from "@/backend/api/client"
import { ContractChip, OwnershipBadge, RiskBadge } from "@/frontend/pages/partners/sections/badges"

/**
 * What the verification rules say about the parties on this order.
 *
 * The verdict comes from the server — the same `loadOrderGate` the create,
 * updateDeal and transition mutations call — so the banner cannot promise a
 * booking the server would refuse, or stay quiet about one it would flag.
 *
 * Two tones: destructive when enforcement is set to block and something here
 * disqualifies the carrier, plain warning otherwise. In warn mode the
 * booking still goes through, but the order is flagged for review, and the
 * banner says so rather than implying nothing happened.
 */
export function KycGateBanner({
    carrierId,
    driverId,
    truckPlate,
    trailerPlate,
    linkPlate,
}: {
    carrierId?: string | null
    driverId?: string | null
    truckPlate?: string | null
    trailerPlate?: string | null
    linkPlate?: string | null
}) {
    const t = useTranslations("Admin.partners.gate")
    const trpc = useTRPC()

    const { data: gate } = useQuery({
        ...trpc.kyc.orderGate.queryOptions({
            carrierId: carrierId ?? "",
            driverId,
            truckPlate,
            trailerPlate,
            linkPlate,
        }),
        enabled: Boolean(carrierId),
    })

    // Nothing to say about a carrier that is verified, unflagged, and whose
    // rig is fully checked
    if (!gate || (gate.carrier.eligible && gate.requirements.length === 0)) {
        return null
    }

    const blocking = gate.blocked

    return (
        <Alert variant={blocking ? "destructive" : undefined}>
            {blocking ? <IconShieldExclamation /> : <IconAlertTriangle />}

            <AlertTitle>{t(blocking ? "blocked.title" : "warning.title")}</AlertTitle>

            <AlertDescription className="flex flex-col gap-2">
                <span>
                    {blocking
                        ? t(`codes.${gate.carrier.eligible ? "UNKNOWN" : gate.carrier.code}`)
                        : t("warning.description")}
                </span>

                <div className="flex flex-wrap items-center gap-1.5">
                    {/* The contract is called out on its own: without it the
                        carrier cannot operate whatever else it holds */}
                    {!gate.carrier.eligible && gate.carrier.code.startsWith("CARRIER_CONTRACT") && (
                        <ContractChip
                            state={gate.carrier.code === "CARRIER_CONTRACT_EXPIRED" ? "expired" : "missing"}
                        />
                    )}

                    <RiskBadge level={gate.riskLevel} reason={gate.riskReason} />

                    {gate.thirdParty.map((subject) => (
                        <span key={subject.label} className="inline-flex items-center gap-1">
                            <span className="text-xs tabular-nums">{subject.label}</span>
                            <OwnershipBadge status="third-party" />
                        </span>
                    ))}
                </div>

                {/* What proceeding will cost, stated before they proceed */}
                {!blocking && gate.requirements.includes("flag") && (
                    <span className="text-xs">{t("warning.will-flag")}</span>
                )}

                {gate.requirements.includes("manager") && (
                    <span className="text-xs">
                        {t(gate.mode === "block" ? "warning.needs-manager" : "warning.high-risk")}
                    </span>
                )}
            </AlertDescription>
        </Alert>
    )
}
