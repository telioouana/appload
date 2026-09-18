"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { useFormatter, useTranslations } from "@workspace/i18n"

import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "@workspace/ui/components/chart"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "@workspace/ui/components/chart-primitives"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"

import { useTRPC } from "@/backend/api/client"
import { overviewInput, type RateSource } from "@/frontend/pages/metrics/types"

/** A long list of provisional months would bury the count that matters. */
const LISTED = 8

/**
 * The rate every figure on this page was converted with. It is the one number
 * here that is not Claire's — it is pinned from the quote of each month's
 * first day and never recomputed, which is why last year's revenue stops
 * moving every morning the way the sheet's own "eq. USD" columns do.
 *
 * USD → MZN has sat within a few tenths of 63.9 since 2022, so it is a figure
 * and not a line; the rand is the one that actually travels, and it is the
 * line under the pair. A month the feed could not answer for borrows a
 * neighbour's rate, and says so rather than showing a gap.
 */
export function RatesCard() {
    const t = useTranslations("Admin.metrics")
    const f = useFormatter()
    const trpc = useTRPC()

    const { data } = useSuspenseQuery(trpc.metrics.overview.queryOptions(overviewInput()))

    const months = data.months

    // The timeline always ends on the month being lived in; the fallback is
    // for the morning of the first of a month, before the sheet has a row
    const current = months.find((month) => month.key === data.currentMonth) ?? months.at(-1)
    const provisional = months.filter((month) => month.rate.provisional)

    // Mid-month at UTC: Maputo is UTC+2, so the label can never slip a month
    const midMonth = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 15))

    // Where a rate came from, in Claire's words rather than the sheet's
    const sourceLabel: Record<RateSource, string> = {
        feed: t("rates.source.feed"),
        yahoo: t("rates.source.yahoo"),
        manual: t("rates.source.manual"),
    }

    // The rate is the scaffolding under the money, not a measure beside it,
    // so it wears ink instead of taking a hue the money cards read as a series
    const config = {
        zar: { label: t("rates.usd-zar"), color: "var(--muted-foreground)" },
    } satisfies ChartConfig

    // Past two years there is no room for twelve labels a year, so only the
    // ticks that open a year keep their text — the same axis the other bands draw
    const dense = months.length > 24

    const axis = new Map(months.map((month, index) => {
        const short = f.dateTime(midMonth(month.year, month.month), { month: "short" })
        const opensAYear = month.month === 1 || index === 0

        return [month.key, opensAYear ? `${short} ${month.year}` : dense ? "" : short]
    }))

    const titles = new Map(months.map((month) => {
        return [month.key, f.dateTime(midMonth(month.year, month.month), { month: "long", year: "numeric" })]
    }))

    // The month rides in as `stamp`, never as `key`: recharts spreads a data
    // row onto the element it draws, and React would read a field called
    // `key` as that element's key
    const points = months.map((month) => ({ stamp: month.key, zar: month.rate.usdZar }))

    const rate = (value: number) => f.number(value, { maximumFractionDigits: 4 })

    // "Pinned on" is a column Claire can type into — the footnote invites her
    // to — so the instant is checked before it is formatted rather than
    // trusted: an unparseable one throws inside the formatter and takes the
    // whole card down with it. Without a date the line names the source alone.
    const stamp = current?.rate.pinnedOn ? new Date(current.rate.pinnedOn) : null
    const pinnedAt = stamp && !Number.isNaN(stamp.getTime()) ? stamp : null

    const figures = current
        ? [
              { key: "mzn", label: t("rates.usd-mzn"), value: current.rate.usdMzn },
              { key: "zar", label: t("rates.usd-zar"), value: current.rate.usdZar },
          ]
        : []

    // Eight names, then an ellipsis: the count in front of the list is the
    // part that says how much of the page is approximate
    const listed = provisional
        .slice(0, LISTED)
        .map((month) => f.dateTime(midMonth(month.year, month.month), { month: "short", year: "numeric" }))
        .join(", ")

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="text-sm font-medium">{t("rates.title")}</h2>
                <span className="text-muted-foreground shrink-0 text-xs">{t("rates.this-month")}</span>
            </header>

            {!current ? (
                <p className="text-muted-foreground text-sm">{t("rates.empty")}</p>
            ) : (
                <div className="flex flex-col gap-1.5">
                    <dl className="grid grid-cols-2 gap-3">
                        {figures.map((figure) => (
                            <div key={figure.key} className="flex flex-col gap-0.5">
                                <dt className="text-muted-foreground text-xs">{figure.label}</dt>
                                <dd className="flex items-baseline gap-1 text-xl leading-tight font-semibold tracking-tight tabular-nums">
                                    {/* The mark says the figures on this page
                                        are close, not exact — the same one the
                                        month table carries on its rate column */}
                                    {current.rate.provisional && (
                                        <Tooltip>
                                            {/* A button rather than a span: the
                                                explanation lives in the tooltip,
                                                and only something focusable can
                                                be reached to open it */}
                                            <TooltipTrigger asChild>
                                                <button
                                                    type="button"
                                                    aria-label={t("rates.provisional")}
                                                    className="text-muted-foreground focus-visible:ring-ring/50 cursor-default rounded-sm text-sm font-normal outline-none focus-visible:ring-3"
                                                >
                                                    ≈
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent>{t("rates.provisional")}</TooltipContent>
                                        </Tooltip>
                                    )}
                                    {rate(figure.value)}
                                </dd>
                            </div>
                        ))}
                    </dl>

                    {/* A rate typed into the sheet by hand carries no date, so
                        it is named by where it came from and nothing more */}
                    <p className="text-muted-foreground text-xs">
                        {pinnedAt
                            ? t("rates.pinned", {
                                  date: f.dateTime(pinnedAt, { dateStyle: "medium" }),
                                  source: sourceLabel[current.rate.source],
                              })
                            : sourceLabel[current.rate.source]}
                    </p>
                </div>
            )}

            {points.length > 0 && (
                <div className="flex flex-col gap-1.5">
                    <span className="text-muted-foreground text-xs">{t("rates.zar-trend")}</span>

                    <ChartContainer
                        config={config}
                        className="h-[120px] w-full"
                        initialDimension={{ width: 320, height: 120 }}
                    >
                        <LineChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                            <CartesianGrid vertical={false} strokeDasharray="3 3" />
                            {/* The month key is the axis category — unique
                                across the years, so the blanked-out ticks
                                cannot collide with one another */}
                            <XAxis
                                dataKey="stamp"
                                interval={0}
                                tickLine={false}
                                axisLine={false}
                                tick={{ fontSize: 11 }}
                                tickMargin={8}
                                tickFormatter={(value: string) => axis.get(value) ?? ""}
                            />
                            {/* A rate has no meaningful zero, and four years of
                                it drawn against one would be a flat line; the
                                axis prints the range it drew, so the zoom is
                                on the page rather than hidden in it */}
                            <YAxis
                                domain={["auto", "auto"]}
                                tickLine={false}
                                axisLine={false}
                                width={30}
                                tick={{ fontSize: 11 }}
                                tickFormatter={(value: number) => f.number(value, { maximumFractionDigits: 0 })}
                            />

                            <ChartTooltip
                                content={
                                    <ChartTooltipContent
                                        labelFormatter={(label) => titles.get(String(label)) ?? String(label)}
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
                                                    {typeof value === "number" ? rate(value) : String(value ?? "")}
                                                </span>
                                            </>
                                        )}
                                    />
                                }
                            />

                            <Line type="monotone" dataKey="zar" stroke="var(--color-zar)" strokeWidth={2} dot={false} />
                        </LineChart>
                    </ChartContainer>
                </div>
            )}

            {provisional.length > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                    {t("rates.provisional-months", { count: provisional.length })}
                    {" · "}
                    {provisional.length > LISTED ? `${listed}…` : listed}
                </p>
            )}

            {/* A stale read is a fact about the whole page, not about the
                rates, so the header carries it — once */}
            <p className="text-muted-foreground text-xs">{t("rates.note")}</p>
        </section>
    )
}
