"use client"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import type { AnalyticsMoney } from "@/frontend/pages/analytics/types"

/**
 * Where the company's money stands, per currency and never summed across
 * them — only the tenant's own leg of each deal: what a client still owes
 * its carriers and what it has paid, or what a carrier is still to receive
 * and what has come in. The other side of the trade and Appload's commission
 * are not projected here, so there is nothing on this card the reader is not
 * a party to.
 *
 * The insurance line only appears where it is actually the reader's cost —
 * a client that subscribed the cover — and a currency only appears once it
 * carries something, so a quiet year leaves the card empty rather than
 * showing rows of zeros.
 */
export function MoneyCard({ data, className }: { data: AnalyticsMoney; className?: string }) {
    const t = useTranslations("App.analytics.money")
    const f = useFormatter()

    const amount = (value: number) => f.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    return (
        <section className={cn(
            "bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1",
            className,
        )}>
            <h2 className="text-sm font-medium">{t("title")}</h2>

            {data.byCurrency.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("empty")}</p>
            ) : (
                <div className="flex flex-col gap-4">
                    {data.byCurrency.map((line) => (
                        <div key={line.currency}>
                            <span className="text-muted-foreground text-xs font-medium">{line.currency}</span>

                            <dl className="mt-1">
                                <div className="flex items-baseline justify-between gap-4 border-t py-2.5 text-[13px]">
                                    <dt className="text-muted-foreground">{t(`${data.leg}.outstanding`)}</dt>
                                    <dd className="font-semibold tabular-nums">{amount(line.outstanding)}</dd>
                                </div>

                                <div className="flex items-baseline justify-between gap-4 border-t py-2.5 text-[13px]">
                                    <dt className="text-muted-foreground">{t(`${data.leg}.settled`)}</dt>
                                    <dd className="tabular-nums">{amount(line.settled)}</dd>
                                </div>

                                {line.insurance !== null && (
                                    <div className="flex items-baseline justify-between gap-4 border-t py-2.5 text-[13px]">
                                        <dt className="text-muted-foreground">{t("insurance")}</dt>
                                        <dd className="tabular-nums">{amount(line.insurance)}</dd>
                                    </div>
                                )}
                            </dl>
                        </div>
                    ))}
                </div>
            )}

            <p className="text-muted-foreground text-xs">{t(`${data.leg}.hint`)}</p>
        </section>
    )
}
