import { IconQuote } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { REVIEWS } from "@/content/site"
import { Reveal } from "@/components/motion/reveal"
import { SectionHeading } from "@/frontend/components/sections/section-heading"

function initials(name: string) {
    return name
        .split(" ")
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase()
}

export function Reviews() {
    const t = useTranslations("home")

    return (
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading title={t("reviews")} align="center" />

            {/* Horizontal snap scroll on small screens (scrollbar hidden via
                container-snap), 3-up grid on large */}
            <div className="container-snap mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto lg:grid lg:grid-cols-3 lg:overflow-visible">
                {REVIEWS.map((review, index) => (
                    <Reveal
                        key={review.name}
                        delay={index * 100}
                        className="min-w-[85%] snap-center sm:min-w-[60%] lg:min-w-0"
                    >
                        <figure className="flex h-full flex-col rounded-3xl border border-border bg-card p-6">
                            <IconQuote className="size-6 text-(--brand-orange)" aria-hidden />
                            <blockquote className="mt-4 flex-1 text-sm leading-relaxed text-muted-foreground">
                                {review.text}
                            </blockquote>
                            <figcaption className="mt-6 flex items-center gap-3">
                                <span className="flex size-10 shrink-0 items-center justify-center rounded-3xl bg-(--brand-orange)/10 text-sm font-semibold text-(--brand-orange)">
                                    {initials(review.name)}
                                </span>
                                <span>
                                    <span className="block text-sm font-semibold text-foreground">{review.name}</span>
                                    <span className="block text-xs text-muted-foreground">{review.role}</span>
                                </span>
                            </figcaption>
                        </figure>
                    </Reveal>
                ))}
            </div>
        </section>
    )
}
