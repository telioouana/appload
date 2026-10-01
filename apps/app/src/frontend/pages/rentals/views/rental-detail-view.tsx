"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { SectionCard } from "@workspace/ui/customs/detail/section-card"
import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { DiaryCard } from "@/frontend/pages/rentals/sections/diary-card"
import { FileCard } from "@/frontend/pages/rentals/sections/file-card"
import { LinesCard } from "@/frontend/pages/rentals/sections/lines-card"
import { MoneyCard } from "@/frontend/pages/rentals/sections/money-card"
import { RentalHeader } from "@/frontend/pages/rentals/sections/rental-header"
import { TermsCard } from "@/frontend/pages/rentals/sections/terms-card"

/**
 * One rental on one page: what was agreed, which trucks are on it, the
 * diary of how each day counted and what it all comes to; the signed paper
 * and the owner's notes on the right. The server already cut the data by
 * role — a client reads no buy prices, a provider only its own trucks and
 * never the paper.
 */
export function RentalDetailView({ rentalId }: { rentalId: string }) {
    const t = useTranslations("App.rentals.detail")
    const f = useFormatter()
    const trpc = useTRPC()

    const { data: rental } = useSuspenseQuery(trpc.rentals.get.queryOptions({ id: rentalId }))

    const owner = rental.role === "owner"
    const aside = rental.role !== "carrier"

    return (
        <>
            <RentalHeader rental={rental} />

            <div className={cn(
                "grid gap-4 px-2 pb-2 lg:min-h-0 lg:flex-1",
                aside && "lg:grid-cols-[minmax(0,1fr)_minmax(320px,26rem)]",
            )}>
                <div className="container-snap flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pb-2">
                    <TermsCard rental={rental} />

                    <LinesCard rental={rental} />

                    <DiaryCard rental={rental} />

                    <MoneyCard rental={rental} />

                    <p className="text-muted-foreground px-1 text-xs">
                        {t("footer", {
                            created: f.dateTime(rental.createdAt, { dateStyle: "medium" }),
                            updated: f.dateTime(rental.updatedAt, { dateStyle: "medium", timeStyle: "short" }),
                        })}
                    </p>
                </div>

                {aside && (
                    <div className="container-snap flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pb-2">
                        <FileCard rental={rental} />

                        {owner && rental.notes && (
                            <SectionCard title={t("notes")}>
                                <p className="text-[13px] whitespace-pre-line">{rental.notes}</p>
                            </SectionCard>
                        )}
                    </div>
                )}
            </div>
        </>
    )
}
