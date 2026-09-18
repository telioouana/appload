import Image from "next/image"
import { IconArrowDown } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { Button } from "@workspace/ui/components/button"

import { Link } from "@/i18n/navigation"
import { SHOW_METRICS } from "@/content/site"
import { MetricsDashboard } from "@/frontend/pages/home/metrics-dashboard"
import type { PublicMetrics } from "@/lib/metrics"

/**
 * Full-bleed, full-screen banner hero: the truck photo covers the whole
 * first viewport with the fixed header floating on top; the live metrics
 * dashboard reveals on scroll, still on the dark canvas. Entrance is a
 * staggered page-load sequence (badge → headline → subtitle → CTAs).
 */
export function Hero({ metrics }: { metrics: PublicMetrics | null }) {
    const tHome = useTranslations("home")
    const tHero = useTranslations("hero")
    const tMetrics = useTranslations("metrics")

    return (
        <section className="relative bg-(--canvas)">
            <div className="relative flex min-h-svh flex-col">
                {/* Banner stack: full-strength photo → flat veil → bottom
                    fade into the canvas → warm spotlight */}
                <Image
                    src="/banners/shipper-banner.png"
                    alt=""
                    aria-hidden
                    fill
                    priority
                    quality={70}
                    sizes="100vw"
                    className="object-cover object-[70%_center]"
                />
                <div className="canvas-veil pointer-events-none absolute inset-0" aria-hidden />
                <div className="canvas-bottom-fade pointer-events-none absolute inset-x-0 bottom-0 h-48" aria-hidden />
                <div className="canvas-spot pointer-events-none absolute inset-0" aria-hidden />

                <div className="relative flex flex-1 flex-col items-center justify-center px-4 pt-16 text-center">
                    {SHOW_METRICS && (
                        <p
                            className="enter inline-flex items-center gap-2 rounded-3xl border border-white/20 px-3.5 py-1.5 text-xs font-medium text-emerald-400"
                            style={{ "--enter-delay": "0ms" } as React.CSSProperties}
                        >
                            <span className="pulse-dot size-1.5 rounded-full bg-emerald-400" aria-hidden />
                            {tHero("badge")}
                        </p>
                    )}

                    {/* The slogan is display text; the descriptive subtitle
                        carries the h1 so the page's main heading says what
                        Appload is (same visual output either way) */}
                    <p
                        className="enter mt-6 font-heading text-[clamp(2.75rem,8vw,5.5rem)] font-extrabold uppercase leading-[1.02] tracking-tight text-white"
                        style={{ "--enter-delay": "120ms" } as React.CSSProperties}
                    >
                        {tHome("slogan")}
                    </p>

                    <h1
                        className="enter mt-5 max-w-xl text-balance text-sm leading-relaxed text-white/80 sm:text-base"
                        style={{ "--enter-delay": "240ms" } as React.CSSProperties}
                    >
                        {tHero("subtitle")}
                    </h1>

                    <div
                        className="enter mt-8 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row"
                        style={{ "--enter-delay": "360ms" } as React.CSSProperties}
                    >
                        <Button
                            asChild
                            size="lg"
                            className="bg-white text-(--canvas) hover:bg-white/85"
                        >
                            <Link href="/shipper">{tHome("button.shipper")}</Link>
                        </Button>
                        <Button
                            asChild
                            size="lg"
                            variant="outline"
                            className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white dark:bg-transparent"
                        >
                            <Link href="/carrier">{tHome("button.carrier")}</Link>
                        </Button>
                    </div>
                </div>

                {SHOW_METRICS && (
                    <div className="relative flex items-center justify-between gap-4 px-5 pb-6 text-xs text-white/60 sm:px-8">
                        <a href="#numbers" className="inline-flex items-center gap-1.5 transition-colors hover:text-white">
                            <IconArrowDown className="size-3.5" aria-hidden />
                            {tHero("scroll")} — {tMetrics("title")}
                        </a>
                        <span className="hidden sm:block">{tMetrics("updated")}</span>
                    </div>
                )}
            </div>

            {SHOW_METRICS && (
                <div className="relative pt-6 sm:pt-10">
                    <MetricsDashboard metrics={metrics} />
                </div>
            )}
        </section>
    )
}
