"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { Link } from "@/i18n/navigation"
import { PIPELINE_ATTENTION, PIPELINE_STAGES, type AnalyticsPipeline } from "@/frontend/pages/analytics/types"
import type { MovementSection } from "@/frontend/pages/movements/types"

/**
 * Where each waiting number opens: the section of the Orders page that holds
 * those loads, since an Appload order is one of the company's own. The other
 * organization type's keys come back as 0 and are simply never rendered, so
 * the two sides need no branch here: a company only ever has counts for the
 * work it does. No tab is named — the page settles it on the company's own
 * default, which is where these rows sit.
 */
const ATTENTION: Record<keyof AnalyticsPipeline["attention"], MovementSection> = {
    awaitingOffers: "procurement",
    offersToReview: "procurement",
    newRequests: "procurement",
    toDispatch: "booked",
    onTheRoad: "in-progress",
    deliveredPending: "delivered",
}

/**
 * Where the company's order book stands: how many orders sit in each stage,
 * and under them the ones actually waiting on somebody — each a door to the
 * exact list it counts.
 *
 * These counts are today's, whatever period the rest of the page is read
 * over: a pipeline is a position, not a stretch of time, and the line under
 * the card says so rather than letting the period select seem to move it.
 */
export function PipelineTiles() {
    const t = useTranslations("App.analytics.pipeline")
    const f = useFormatter()
    const trpc = useTRPC()

    const { data } = useSuspenseQuery(trpc.analytics.pipeline.queryOptions())

    const waiting = PIPELINE_ATTENTION.filter((key) => data.attention[key] > 0)

    return (
        <section className="bg-card ring-foreground/5 dark:ring-foreground/10 mx-2 flex flex-col gap-3.5 rounded-2xl px-5 py-4 ring-1">
            <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="text-sm font-medium">{t("title")}</h2>
                <span className="text-muted-foreground text-xs tabular-nums">{t("total", { count: data.total })}</span>
            </header>

            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                {PIPELINE_STAGES.map((key) => (
                    <div key={key} className="flex flex-col">
                        <dt className="text-muted-foreground text-xs font-medium">{t(`sections.${key}`)}</dt>
                        <dd className="text-xl leading-tight font-semibold tracking-tight tabular-nums">
                            {f.number(data.sections[key])}
                        </dd>
                    </div>
                ))}
            </dl>

            {data.total === 0 ? (
                <p className="text-muted-foreground text-sm">{t("empty")}</p>
            ) : (
                waiting.length > 0 && (
                    <div className="flex flex-wrap gap-2 border-t pt-3">
                        {waiting.map((key) => (
                            <Link
                                key={key}
                                href={{ pathname: "/orders/[section]", params: { section: ATTENTION[key] } }}
                                className="ring-foreground/10 hover:ring-primary/40 focus-visible:ring-ring/50 flex items-center gap-2 rounded-full px-3 py-1 text-xs ring-1 transition-colors outline-none focus-visible:ring-3"
                            >
                                <span className="text-muted-foreground">{t(`attention.${key}`)}</span>
                                <span className="font-semibold tabular-nums">{f.number(data.attention[key])}</span>
                            </Link>
                        ))}
                    </div>
                )
            )}

            <p className="text-muted-foreground text-xs">{t("hint")}</p>
        </section>
    )
}
