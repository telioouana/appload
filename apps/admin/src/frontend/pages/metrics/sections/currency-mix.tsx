"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { useFormatter, useTranslations } from "@workspace/i18n"

import {
    ChartContainer,
    ChartLegend,
    ChartLegendContent,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "@workspace/ui/components/chart"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "@workspace/ui/components/chart-primitives"

import { useTRPC } from "@/backend/api/client"
import { overviewInput } from "@/frontend/pages/metrics/types"
import type { Currency } from "@/frontend/pages/orders/types"

/** Stacked in the order the sheet and the cashflow strip list them. */
const CURRENCIES: readonly Currency[] = ["MZN", "ZAR", "USD"]

/**
 * Which currency the year's sales were invoiced in, as a share of the
 * USD-equivalent total. Appload started with a real South African leg and has
 * since become a Maputo business invoicing in meticais; the card is where
 * that shift is visible, and it is the reason a rand column still exists in
 * the sheet.
 *
 * Full-height columns, not a pie: the eye compares heights across years far
 * better than it compares wedges, and there is nothing here worth a wedge.
 */
export function CurrencyMix() {
    const t = useTranslations("Admin.metrics")
    const f = useFormatter()
    const trpc = useTRPC()

    const { data } = useSuspenseQuery(trpc.metrics.overview.queryOptions(overviewInput()))

    // Three categorical hues rather than the --chart ramp: currencies are
    // identities, not a magnitude. In light mode they are the status tokens
    // (indigo, teal, amber — none of them the red or the green that mean
    // something else across the admin). The dark tokens of the same names are
    // badge text — pale, low-chroma and all at one lightness — and as
    // full-height blocks on a dark card they go chalky and blur into each
    // other, so dark mode gets the same three hues as saturated mid-tones,
    // the way the money charts pair their themes.
    const config = {
        MZN: { label: "MZN", theme: { light: "var(--status-loading-text)", dark: "oklch(0.64 0.15 278)" } },
        ZAR: { label: "ZAR", theme: { light: "var(--status-offloading-text)", dark: "oklch(0.74 0.12 200)" } },
        USD: { label: "USD", theme: { light: "var(--status-stopped-text)", dark: "oklch(0.76 0.16 57)" } },
    } satisfies ChartConfig

    // A year with no sales has no shares to normalise; drawing it would put a
    // full-height column of whichever series recharts reached first
    const points = data.years
        .filter((year) => CURRENCIES.some((currency) => year.currencyShare[currency] > 0))
        .map((year) => ({
            label: year.partial ? t("year-to-date", { year: String(year.year) }) : String(year.year),
            MZN: year.currencyShare.MZN,
            ZAR: year.currencyShare.ZAR,
            USD: year.currencyShare.USD,
        }))

    const share = (value: number, digits: number) =>
        f.number(value, { style: "percent", maximumFractionDigits: digits })

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <h2 className="text-sm font-medium">{t("mix.title")}</h2>

            {points.length === 0 ? (
                <p className="text-muted-foreground flex h-[220px] items-center justify-center text-center text-sm xl:h-[260px]">
                    {t("mix.empty")}
                </p>
            ) : (
                <ChartContainer
                    config={config}
                    className="h-[220px] w-full xl:h-[260px]"
                    initialDimension={{ width: 640, height: 260 }}
                >
                    {/* The shares already sum to one; `expand` keeps the column
                        square to the axis whatever rounding did to them */}
                    <BarChart data={points} stackOffset="expand" margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickMargin={8} />
                        <YAxis
                            domain={[0, 1]}
                            ticks={[0, 0.25, 0.5, 0.75, 1]}
                            tickLine={false}
                            axisLine={false}
                            width={40}
                            tick={{ fontSize: 11 }}
                            tickFormatter={(value: number) => share(value, 0)}
                        />

                        <ChartTooltip
                            content={
                                <ChartTooltipContent
                                    formatter={(value, name, item) => (
                                        <>
                                            <span
                                                className="size-2.5 shrink-0 rounded-[2px]"
                                                style={{ backgroundColor: item.color }}
                                            />
                                            <span className="text-muted-foreground flex-1">
                                                {config[String(name) as keyof typeof config]?.label ?? name}
                                            </span>
                                            <span className="text-foreground font-mono font-medium tabular-nums">
                                                {typeof value === "number" ? share(value, 1) : String(value ?? "")}
                                            </span>
                                        </>
                                    )}
                                />
                            }
                        />
                        <ChartLegend content={<ChartLegendContent />} itemSorter={null} />

                        {CURRENCIES.map((currency, index) => (
                            <Bar
                                key={currency}
                                dataKey={currency}
                                stackId="mix"
                                fill={`var(--color-${currency})`}
                                // A hairline of the card between the segments:
                                // two saturated fills meeting edge to edge read
                                // as one band at these shares
                                stroke="var(--card)"
                                strokeWidth={2}
                                radius={index === CURRENCIES.length - 1 ? [4, 4, 0, 0] : undefined}
                            />
                        ))}
                    </BarChart>
                </ChartContainer>
            )}

            <p className="text-muted-foreground text-xs">{t("mix.note")}</p>
        </section>
    )
}
