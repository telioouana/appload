"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { SectionCard } from "@workspace/ui/customs/detail/section-card"
import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { AllocationsCard } from "@/frontend/pages/contracts/sections/allocations-card"
import { ContractHeader } from "@/frontend/pages/contracts/sections/contract-header"
import { FileCard } from "@/frontend/pages/contracts/sections/file-card"
import { TermsCard } from "@/frontend/pages/contracts/sections/terms-card"
import { TripsCard } from "@/frontend/pages/contracts/sections/trips-card"

/**
 * One contract on one page: what was agreed, who moves which part of it,
 * and the trips filed under it so far; the signed paper and the owner's
 * notes on the right. This file owns the query and hands each block what
 * it renders; what the reader may see and do was decided by the server,
 * role by role — a client reads no shares, a transporter reads only its
 * own and never the paper.
 */
export function ContractDetailView({ contractId }: { contractId: string }) {
    const t = useTranslations("App.contracts.detail")
    const f = useFormatter()
    const trpc = useTRPC()

    const { data: contract } = useSuspenseQuery(trpc.contracts.get.queryOptions({ id: contractId }))

    const owner = contract.role === "owner"
    // The paper is between the owner and the client; a transporter's share
    // of it is on the left, so its page has one column
    const aside = contract.role !== "carrier"

    return (
        <>
            <ContractHeader contract={contract} />

            {/* From lg up the page itself does not scroll: each column does */}
            <div className={cn(
                "grid gap-4 px-2 pb-2 lg:min-h-0 lg:flex-1",
                aside && "lg:grid-cols-[minmax(0,1fr)_minmax(320px,26rem)]",
            )}>
                <div className="container-snap flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pb-2">
                    <TermsCard contract={contract} />

                    {contract.role !== "client" && <AllocationsCard contract={contract} />}

                    <TripsCard contract={contract} />

                    <p className="text-muted-foreground px-1 text-xs">
                        {t("footer", {
                            created: f.dateTime(contract.createdAt, { dateStyle: "medium" }),
                            updated: f.dateTime(contract.updatedAt, { dateStyle: "medium", timeStyle: "short" }),
                        })}
                    </p>
                </div>

                {aside && (
                    <div className="container-snap flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pb-2">
                        <FileCard contract={contract} />

                        {owner && contract.notes && (
                            <SectionCard title={t("notes")}>
                                <p className="text-[13px] whitespace-pre-line">{contract.notes}</p>
                            </SectionCard>
                        )}
                    </div>
                )}
            </div>
        </>
    )
}
