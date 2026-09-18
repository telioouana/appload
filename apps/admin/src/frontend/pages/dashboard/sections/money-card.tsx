"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { IconArrowRight } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { Link } from "@/i18n/navigation"
import { moneyTone, type MoneyTone } from "@workspace/ui/lib/money-tone"
import { moneyInput } from "@/frontend/pages/dashboard/types"
import { currentYear, type CashflowLine } from "@/frontend/pages/orders/types"

/** The four figures of a currency's line, in the order the money moves. */
type MoneyRow = {
    key: keyof Pick<CashflowLine, "receivables" | "payables" | "insurance" | "cashflow">
    label: string
    tone: MoneyTone
    /** The bottom line, weighted so it reads first */
    emphasis?: boolean
}

/**
 * Where the year stands, per currency and never summed across them — the
 * same four figures the cashflow strip shows above the orders list, read from
 * Appload's side: money in from shippers, money out to carriers and insurers,
 * and what is left. A currency only appears once it carries something, so a
 * quiet year leaves the card empty rather than showing rows of zeros.
 */
export function MoneyCard({ year }: { year?: number }) {
    const t = useTranslations("Admin.dashboard")
    const f = useFormatter()
    const trpc = useTRPC()

    const { data } = useSuspenseQuery(trpc.orders.cashflow.queryOptions(moneyInput(year)))

    const rows: MoneyRow[] = [
        { key: "receivables", label: t("money.receivables"), tone: "positive" },
        { key: "payables", label: t("money.payables"), tone: "negative" },
        { key: "insurance", label: t("money.insurance"), tone: "negative" },
        { key: "cashflow", label: t("money.cashflow"), tone: "signed", emphasis: true },
    ]

    // The strip on the orders list is this same money; the year only rides in
    // the URL when it is not the current one, which is what the list defaults to
    const query = data.year === currentYear() ? undefined : { year: String(data.year) }

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <header className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium">{t("money.title", { year: data.year })}</h2>

                <Link
                    href={{ pathname: "/orders/all", query }}
                    className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1.5 text-xs"
                >
                    {t("money.open")}
                    <IconArrowRight className="size-3.5" stroke={1.5} />
                </Link>
            </header>

            {data.lines.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("money.empty", { year: data.year })}</p>
            ) : (
                <div className="flex flex-col gap-4">
                    {data.lines.map((line) => (
                        <div key={line.currency}>
                            <span className="text-muted-foreground text-xs font-medium">{line.currency}</span>

                            <dl className="mt-1">
                                {rows.map((row) => {
                                    const value = line[row.key]

                                    return (
                                        <div
                                            key={row.key}
                                            className="flex items-baseline justify-between gap-4 border-t py-2.5 text-[13px]"
                                        >
                                            <dt className="text-muted-foreground">{row.label}</dt>
                                            <dd className={cn(
                                                "tabular-nums",
                                                row.emphasis && "font-semibold",
                                                moneyTone(row.tone, value),
                                            )}>
                                                {f.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </dd>
                                        </div>
                                    )
                                })}
                            </dl>
                        </div>
                    ))}
                </div>
            )}
        </section>
    )
}
