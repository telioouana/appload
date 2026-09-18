import { useTranslations } from "@workspace/i18n"

import { CountUp } from "@/components/motion/count-up"
import { Reveal } from "@/components/motion/reveal"
import { GrowthChart } from "@/frontend/pages/home/growth-chart"
import type { GrowthStat, PublicMetrics } from "@/lib/metrics"

type HeadlineKey =
    | "headline_tons_yoy" | "headline_tons_qoq"
    | "headline_loads_yoy" | "headline_loads_qoq";

type TileKey = "years" | "repeat_shippers" | "corridors" | "provinces";

type Tile = {
    key: TileKey;
    /** Live value animated by CountUp; null renders a placeholder */
    value: number | null;
    /** Render as a growth multiple ("3.3×") instead of a plain number */
    multiple?: boolean;
    suffix?: string;
};

/** "+230%" → 3.3, the plain-language way to say growth. */
function toMultiple(growth: GrowthStat): number {
    return (growth.pct + 100) / 100
}

/**
 * One tile list drives both the live and the null-metrics render, so the
 * fallback can never drift out of sync with the real layout.
 */
function tiles(metrics: PublicMetrics | null): Tile[] {
    return [
        { key: "years", value: metrics?.yearsActive ?? null },
        { key: "repeat_shippers", value: metrics?.repeatShipperPct ?? null, suffix: "%" },
        { key: "corridors", value: metrics ? metrics.corridors : null },
        { key: "provinces", value: metrics ? metrics.provinces : null },
    ]
}

/**
 * The investor dashboard: a product-UI-styled card rising from the hero's
 * bottom edge. Growth, retention and coverage from the production database
 * in billboard language — no cumulative absolutes (they invite comparison
 * with much larger platforms) and no delivery-outcome claims (Appload is a
 * marketplace, not the transporter).
 */
export function MetricsDashboard({ metrics }: { metrics: PublicMetrics | null }) {
    const t = useTranslations("metrics")

    const headline: { multiple: number; label: HeadlineKey } | null = metrics?.tonsGrowth
        ? {
            multiple: toMultiple(metrics.tonsGrowth),
            label: metrics.tonsGrowth.period === "qoq" ? "headline_tons_qoq" : "headline_tons_yoy",
        }
        : metrics?.loadsGrowth
            ? {
                multiple: toMultiple(metrics.loadsGrowth),
                label: metrics.loadsGrowth.period === "qoq" ? "headline_loads_qoq" : "headline_loads_yoy",
            }
            : null

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
                        {headline ? (
                            <CountUp value={headline.multiple} compact suffix="×" />
                        ) : (
                            <span>—</span>
                        )}{" "}
                        <span className="text-sm font-normal text-(--canvas-muted) sm:text-base">
                            {t(headline?.label ?? "headline_tons_qoq")}
                        </span>
                    </p>

                    <div className="mt-6 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                        {tiles(metrics).map((tile, index) => (
                            <Reveal
                                key={tile.key}
                                delay={index * 70}
                                className="rounded-xl bg-black/25 p-3.5"
                            >
                                <p className="text-xl font-semibold tabular-nums text-white sm:text-2xl">
                                    {tile.value !== null ? (
                                        <CountUp
                                            value={tile.value}
                                            compact={tile.multiple}
                                            suffix={tile.multiple ? "×" : tile.suffix}
                                        />
                                    ) : (
                                        <span>—</span>
                                    )}
                                </p>
                                <p className="mt-0.5 text-xs text-(--canvas-muted)">
                                    {t(`tiles.${tile.key}`)}
                                </p>
                            </Reveal>
                        ))}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                        {(["tracked", "insurance"] as const).map((badge) => (
                            <span
                                key={badge}
                                className="rounded-full border border-(--canvas-border) px-3 py-1 text-xs text-(--canvas-muted)"
                            >
                                {t(`quality.${badge}`)}
                            </span>
                        ))}
                    </div>

                    {metrics && metrics.quarters.length > 0 && (
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
