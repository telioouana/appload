"use client"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"

import type { AnalyticsLoads, AnalyticsLoadsLine } from "@/frontend/pages/analytics/types"

/**
 * The year of the company's own loads — its orders and its trips — in its
 * own terms, one block per currency and never summed across them: what its
 * clients owe it and paid, what it owes its partners and paid, what the
 * loads cost to run, and, for the loads that arrived, the margin left.
 *
 * A figure only earns a line once it is not zero, so a shipper — which is
 * never paid for a load — reads its spend and nothing about income, and the
 * margin appears only where one could be worked out. The line under it says
 * how many of the arrived loads that is, rather than quietly dropping the
 * ones priced in two currencies.
 */
export function LoadsCard({ data, className }: { data: AnalyticsLoads; className?: string }) {
    const t = useTranslations("App.analytics.loads")
    const f = useFormatter()

    const amount = (value: number) => f.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    // Margins are a seller's question: a company that never prices a load
    // for anybody is not told how many of its loads have none
    const sells = data.byCurrency.some((line) =>
        line.receivable.outstanding > 0 || line.receivable.settled > 0 || line.margin.loads > 0)

    return (
        <section className={cn(
            "bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1",
            className,
        )}>
            <header className="flex flex-col gap-0.5">
                <h2 className="text-sm font-medium">{t("title")}</h2>
                <p className="text-muted-foreground text-xs">{t("hint", { year: data.year })}</p>
            </header>

            {data.total === 0 ? (
                <p className="text-muted-foreground text-sm">{t("empty", { year: data.year })}</p>
            ) : data.byCurrency.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("no-money", { count: data.total })}</p>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {data.byCurrency.map((line) => (
                        <CurrencyBlock key={line.currency} line={line} amount={amount} />
                    ))}
                </div>
            )}

            {sells && data.finished > 0 && data.comparable < data.finished && (
                <p className="text-muted-foreground text-xs">
                    {t("comparable", { comparable: data.comparable, finished: data.finished })}
                </p>
            )}

            {data.partners.length > 0 && (
                <div className="flex flex-col gap-1.5 border-t pt-3.5">
                    <span className="text-muted-foreground text-xs font-medium">{t("partners.title")}</span>
                    <ul className="flex flex-col">
                        {data.partners.map((partner) => (
                            <li
                                key={`${partner.side}:${partner.id ?? partner.name}`}
                                className="flex items-center justify-between gap-3 py-1 text-[13px]"
                            >
                                <span className="flex min-w-0 items-center gap-2">
                                    <span className="truncate">{partner.name}</span>
                                    <Badge variant="outline" className="shrink-0 rounded-full font-normal">
                                        {t(`partners.${partner.side}`)}
                                    </Badge>
                                </span>
                                <span className="text-muted-foreground shrink-0 tabular-nums">
                                    {t("partners.loads", { count: partner.loads })}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    )
}

function CurrencyBlock({ line, amount }: { line: AnalyticsLoadsLine; amount: (value: number) => string }) {
    const t = useTranslations("App.analytics.loads")

    const rows: Array<{ key: string; label: string; value: number; strong?: boolean }> = [
        { key: "receivable", label: t("receivable"), value: line.receivable.outstanding, strong: true },
        { key: "received", label: t("received"), value: line.receivable.settled },
        { key: "payable", label: t("payable"), value: line.payable.outstanding, strong: true },
        { key: "paid", label: t("paid"), value: line.payable.settled },
        { key: "costs", label: t("costs"), value: line.costs.total },
    ].filter((row) => row.value !== 0)

    const margin = line.margin.loads > 0

    return (
        <div>
            <span className="text-muted-foreground text-xs font-medium">{line.currency}</span>

            <dl className="mt-1">
                {rows.map((row) => (
                    <div key={row.key} className="flex items-baseline justify-between gap-4 border-t py-2 text-[13px]">
                        <dt className="text-muted-foreground">{row.label}</dt>
                        <dd className={cn("tabular-nums", row.strong && "font-semibold")}>{amount(row.value)}</dd>
                    </div>
                ))}

                {line.costs.rechargeable > 0 && (
                    <div className="text-muted-foreground -mt-1 pb-1 text-right text-xs">
                        {t("rechargeable", { amount: amount(line.costs.rechargeable) })}
                    </div>
                )}

                {margin && (
                    <>
                        <div className="flex items-baseline justify-between gap-4 border-t py-2 text-[13px]">
                            <dt className="text-muted-foreground">{t("gross", { count: line.margin.loads })}</dt>
                            <dd className="tabular-nums">{amount(line.margin.gross)}</dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-4 border-t py-2 text-[13px]">
                            <dt className="text-muted-foreground">{t("net")}</dt>
                            <dd className={cn("font-semibold tabular-nums", line.margin.net < 0 && "text-destructive")}>
                                {amount(line.margin.net)}
                            </dd>
                        </div>
                    </>
                )}
            </dl>
        </div>
    )
}
