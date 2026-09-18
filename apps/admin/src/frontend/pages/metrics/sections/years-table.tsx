"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { Scroller } from "@workspace/ui/customs/list/scroller"
import { useMetricsCurrency } from "@/frontend/pages/metrics/hooks/use-metrics-currency"
import { moneyTone } from "@workspace/ui/lib/money-tone"
import { overviewInput, type MetricsLifetime, type MetricYear } from "@/frontend/pages/metrics/types"

/**
 * The change against the year before, under the figure it belongs to. Green
 * up, red down, muted flat — the same reading as every other signed number in
 * the admin. The first year has nothing behind it and prints nothing.
 */
function Yoy({ value, previous }: { value: number | null; previous: number }) {
    const t = useTranslations("Admin.metrics")
    const f = useFormatter()

    if (value === null) return null

    return (
        <span
            title={t("table.yoy", { year: String(previous) })}
            className={cn("block text-[11px] leading-tight", moneyTone("signed", value))}
        >
            {f.number(value, { style: "percent", maximumFractionDigits: 0, signDisplay: "exceptZero" })}
        </span>
    )
}

/**
 * One line of the table. A year and the lifetime total carry exactly the same
 * figures — only the change chips are a year's alone — so both are this
 * component and the header above can never drift from either.
 */
function MetricsRow({
    label,
    value,
    yoy,
    previous,
    className,
}: {
    label: React.ReactNode
    value: MetricsLifetime
    /** The year's change against the one before it; lifetime has nothing to compare with */
    yoy?: MetricYear["yoy"]
    previous?: number
    className?: string
}) {
    const f = useFormatter()
    const { currency } = useMetricsCurrency()

    const money = (amount: number) => f.number(amount, { maximumFractionDigits: 0 })
    const count = (amount: number) => f.number(amount)
    const perTrip = (amount: number | null) => (amount === null ? "—" : f.number(amount, { maximumFractionDigits: 0 }))
    const percent = (amount: number | null) =>
        amount === null ? "—" : f.number(amount, { style: "percent", maximumFractionDigits: 1 })

    // The chips only exist where a year has one to show
    const change = (key: keyof MetricYear["yoy"]) =>
        yoy && previous !== undefined ? <Yoy value={yoy[key]} previous={previous} /> : null

    const cell = "px-2 py-2 text-right tabular-nums"

    return (
        <TableRow className={cn("hover:bg-transparent", className)}>
            {/* The label rides along while the rest of the row scrolls out
                from under it — fifteen columns is more than any screen has */}
            <TableCell className="bg-card sticky left-0 z-10 px-2 py-2 text-left whitespace-nowrap">{label}</TableCell>

            <TableCell className={cell}>
                {f.number(value.trips.total)}
                <span className="text-muted-foreground block text-[11px] leading-tight">
                    {`${f.number(value.trips.national)} / ${f.number(value.trips.regional)}`}
                </span>
                {change("trips")}
            </TableCell>

            <TableCell className={cell}>{f.number(value.deliveries)}</TableCell>
            <TableCell className={cell}>{money(value.distanceKm)}</TableCell>
            <TableCell className={cell}>{count(value.shippers)}</TableCell>
            <TableCell className={cell}>{count(value.carriers)}</TableCell>

            <TableCell className={cell}>
                {money(value.money[currency].sales)}
                {change("sales")}
            </TableCell>

            <TableCell className={cell}>
                {money(value.money[currency].commission)}
                {change("commission")}
            </TableCell>

            <TableCell className={cell}>{money(value.money[currency].iva)}</TableCell>

            <TableCell className={cell}>
                {money(value.money[currency].net)}
                {change("net")}
            </TableCell>

            <TableCell className={cell}>{money(value.money[currency].insurance)}</TableCell>
            <TableCell className={cell}>{money(value.money[currency].prospects)}</TableCell>
            <TableCell className={cell}>{percent(value.margin)}</TableCell>
            <TableCell className={cell}>{perTrip(value.money[currency].salesPerTrip)}</TableCell>
            <TableCell className={cell}>{perTrip(value.money[currency].commissionPerTrip)}</TableCell>
        </TableRow>
    )
}

/**
 * Every year Appload has traded, oldest at the top, with the lifetime total
 * closing the table. Money is USD at each month's own opening rate, summed —
 * the sheet's own "eq. USD" columns would restate 2022 at this morning's
 * rate, which is the one number this page refuses to print.
 *
 * Shippers and carriers are counted once across the year's orders; the
 * months' own counts do not add up, so the year and the lifetime are counted
 * on their own.
 */
export function YearsTable() {
    const t = useTranslations("Admin.metrics")
    const trpc = useTRPC()
    const { code } = useMetricsCurrency()

    const { data } = useSuspenseQuery(trpc.metrics.overview.queryOptions(overviewInput()))

    const head = "h-8 px-2 text-right text-xs font-normal whitespace-nowrap"

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 pt-4 pb-2 ring-1">
            {/* Every money column names its own unit, so the card does not */}
            <h2 className="text-sm font-medium">{t("table.years")}</h2>

            {data.years.length === 0 ? (
                // The table covers the whole timeline, so there is no year to
                // name in the message the month table below uses
                <p className="text-muted-foreground pb-2 text-sm">{t("table.empty-years")}</p>
            ) : (
                // The kit's table brings a scroll container of its own; opened
                // up so this one wrapper is what scrolls, which is also what
                // the sticky first column measures itself against
                <Scroller axis="x" className="[&_[data-slot=table-container]]:overflow-visible">
                    <Table className="text-xs">
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="bg-card sticky left-0 z-10 h-8 px-2 text-xs font-normal">
                                    {t("table.columns.year")}
                                </TableHead>
                                <TableHead className={head}>{t("table.columns.trips")}</TableHead>
                                <TableHead className={head}>{t("table.columns.deliveries")}</TableHead>
                                <TableHead className={head}>{t("table.columns.distance")}</TableHead>
                                <TableHead className={head}>{t("table.columns.shippers")}</TableHead>
                                <TableHead className={head}>{t("table.columns.carriers")}</TableHead>
                                <TableHead className={head}>{t("table.columns.sales", { currency: code })}</TableHead>
                                <TableHead className={head}>{t("table.columns.commission", { currency: code })}</TableHead>
                                <TableHead className={head}>{t("table.columns.vat", { currency: code })}</TableHead>
                                <TableHead className={head}>{t("table.columns.net", { currency: code })}</TableHead>
                                <TableHead className={head}>{t("table.columns.insurance", { currency: code })}</TableHead>
                                <TableHead className={head}>{t("table.columns.prospects", { currency: code })}</TableHead>
                                <TableHead className={head}>{t("table.columns.margin")}</TableHead>
                                <TableHead className={head}>{t("table.columns.sales-per-trip")}</TableHead>
                                <TableHead className={head}>{t("table.columns.commission-per-trip")}</TableHead>
                            </TableRow>
                        </TableHeader>

                        <TableBody>
                            {data.years.map((year) => (
                                <MetricsRow
                                    key={year.year}
                                    label={year.partial ? t("year-to-date", { year: String(year.year) }) : year.year}
                                    value={year}
                                    yoy={year.yoy}
                                    previous={year.year - 1}
                                />
                            ))}
                        </TableBody>

                        <TableFooter className="border-t bg-transparent">
                            <MetricsRow
                                label={t("table.lifetime")}
                                value={data.lifetime}
                                className="border-0 font-semibold"
                            />
                        </TableFooter>
                    </Table>
                </Scroller>
            )}

            <p className="text-muted-foreground text-xs">{t("table.parties-note")}</p>
        </section>
    )
}
