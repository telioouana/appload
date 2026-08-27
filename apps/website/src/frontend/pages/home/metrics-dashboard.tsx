import { useTranslations } from "@workspace/i18n"

import { CountUp } from "@/components/motion/count-up"
import { Reveal } from "@/components/motion/reveal"
import { GrowthChart } from "@/frontend/pages/home/growth-chart"
import type { PublicMetrics } from "@/lib/metrics"

type TileKey = "loads" | "tons" | "km" | "carriers" | "trucks" | "shippers";

function tiles(metrics: PublicMetrics): { key: TileKey; value: number; compact: boolean; approx: boolean }[] {
    return [
        { key: "loads", value: metrics.loadsDelivered, compact: false, approx: true },
        { key: "tons", value: metrics.tonsMoved, compact: true, approx: true },
        { key: "km", value: metrics.kmCovered, compact: true, approx: true },
        { key: "carriers", value: metrics.carriers, compact: false, approx: false },
        { key: "trucks", value: metrics.trucks, compact: false, approx: false },
        { key: "shippers", value: metrics.shippers, compact: false, approx: false },
    ]
}

/**
 * The investor dashboard: a product-UI-styled card rising from the hero's
 * bottom edge, holding live aggregates from the production database.
 */
export function MetricsDashboard({ metrics }: { metrics: PublicMetrics | null }) {
    const t = useTranslations("metrics")

    return (
        <div id="numbers" className="relative mx-auto w-full max-w-4xl scroll-mt-24 px-4 sm:px-6">
            <Reveal>
                <div className="rounded-t-2xl border border-b-0 border-(--canvas-border) bg-(--canvas-card) p-5 sm:p-8">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h2 className="font-heading text-lg font-semibold text-white sm:text-xl">
                            {t("title")}
                        </h2>
                        <p className="text-xs text-(--canvas-faint)">{t("updated")}</p>
                    </div>

                    <p className="mt-2 text-2xl font-semibold text-(--brand-amber) sm:text-3xl">
                        {metrics ? (
                            <CountUp value={metrics.gtvUsd} compact prefix="≈ US$ " />
                        ) : (
                            <span>—</span>
                        )}{" "}
                        <span className="text-sm font-normal text-(--canvas-muted) sm:text-base">
                            {t("gtv_label")}
                        </span>
                    </p>

                    <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                        {metrics
                            ? tiles(metrics).map((tile, index) => (
                                <Reveal
                                    key={tile.key}
                                    delay={index * 70}
                                    className="rounded-xl bg-black/25 p-3.5"
                                >
                                    <p className="text-xl font-semibold tabular-nums text-white sm:text-2xl">
                                        <CountUp value={tile.value} compact={tile.compact} suffix={tile.approx ? "+" : ""} />
                                    </p>
                                    <p className="mt-0.5 text-xs text-(--canvas-muted)">
                                        {t(`tiles.${tile.key}`)}
                                    </p>
                                </Reveal>
                            ))
                            : (["loads", "tons", "km", "carriers", "trucks", "shippers"] as TileKey[]).map((key) => (
                                <div key={key} className="rounded-xl bg-black/25 p-3.5">
                                    <p className="text-xl font-semibold text-white sm:text-2xl">—</p>
                                    <p className="mt-0.5 text-xs text-(--canvas-muted)">{t(`tiles.${key}`)}</p>
                                </div>
                            ))}
                    </div>

                    {metrics && metrics.quarters.some((quarter) => quarter.tons > 0) && (
                        <div className="mt-6 rounded-xl bg-black/25 p-4 sm:p-5">
                            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                                <h3 className="text-sm font-medium text-white">{t("chart_title")}</h3>
                                <p className="text-xs text-(--canvas-faint)">{t("chart_note")}</p>
                            </div>
                            <GrowthChart data={metrics.quarters} />
                        </div>
                    )}
                </div>
            </Reveal>
        </div>
    )
}
