import {
    IconBrandYoutubeFilled,
    IconClipboardList,
    IconCreditCard,
    IconGauge,
    IconMapPin,
    IconRoute,
    IconShieldCheck,
    IconStar,
    IconUserCircle,
    IconWorld,
    type Icon as TablerIcon,
} from "@tabler/icons-react"

import { useMessages, useTranslations } from "@workspace/i18n"

import { Reveal } from "@/components/motion/reveal"
import { PageHero } from "@/frontend/components/sections/page-hero"
import { CtaBand } from "@/frontend/components/sections/cta-band"
import { SectionHeading } from "@/frontend/components/sections/section-heading"

type Audience = "shipper" | "carrier";

const FEATURE_ICONS: Record<Audience, TablerIcon[]> = {
    shipper: [IconWorld, IconClipboardList, IconUserCircle, IconMapPin, IconShieldCheck, IconCreditCard],
    carrier: [IconWorld, IconRoute, IconUserCircle, IconGauge, IconCreditCard, IconStar],
};

const HIGHLIGHT_KEYS: Record<Audience, [string, string]> = {
    shipper: ["deliveries", "chat"],
    carrier: ["management", "tracking"],
};

const HIGHLIGHT_ICONS: Record<Audience, [TablerIcon, TablerIcon]> = {
    shipper: [IconClipboardList, IconUserCircle],
    carrier: [IconGauge, IconMapPin],
};

// Truck-photo backdrops from the original site, already treated for these
// surfaces (red duotone / darkened overhead shot)
const HERO_IMAGES: Record<Audience, { src: string; position: string }> = {
    shipper: { src: "/banners/home-banner.png", position: "center 55%" },
    carrier: { src: "/banners/carrier-banner.png", position: "center 40%" },
};

/** The old dictionaries embed YouTube player URLs; link out to watch pages */
function toWatchUrl(embedUrl: string) {
    const match = embedUrl.match(/\/embed\/([^?]+)(?:\?(.*))?/)
    if (!match) return embedUrl
    const [, id, query] = match
    return `https://www.youtube.com/watch?v=${id}${query ? `&${query}` : ""}`
}

export function AudiencePage({ audience }: { audience: Audience }) {
    const t = useTranslations(audience)
    const messages = useMessages()

    const features = ["feature1", "feature2", "feature3", "feature4", "feature5", "feature6"] as const
    const icons = FEATURE_ICONS[audience]
    const [highlightA, highlightB] = HIGHLIGHT_KEYS[audience]
    const [HighlightIconA, HighlightIconB] = HIGHLIGHT_ICONS[audience]

    const howTo = messages[audience].how_to as Record<string, string | { title: string; link: string }>
    const videos = Object.entries(howTo).filter(
        (entry): entry is [string, { title: string; link: string }] =>
            entry[0].startsWith("video") && typeof entry[1] === "object",
    )

    const audienceMessages = messages[audience] as unknown as Record<string, { title: string }>

    // The old dictionaries aren't shape-consistent here: shipper's section
    // title is {part1, part2}, carrier's is a plain string
    const description = messages[audience].description as unknown as {
        title: string | { part1: string; part2: string };
        body: { part1: string; part2: string };
    }
    const heading = typeof description.title === "string"
        ? { chip: undefined, title: description.title }
        : { chip: description.title.part1, title: description.title.part2 }

    const highlights = [
        { key: highlightA, Icon: HighlightIconA },
        { key: highlightB, Icon: HighlightIconB },
    ] as const

    return (
        <>
            <PageHero
                title={t("title.part1")}
                accent={t("title.part2")}
                subtitle={t("description.body.part1")}
                image={HERO_IMAGES[audience].src}
                imagePosition={HERO_IMAGES[audience].position}
            />

            <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
                <SectionHeading
                    chip={heading.chip}
                    title={heading.title}
                    subtitle={description.body.part2}
                />

                <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {features.map((key, index) => {
                        const Icon = icons[index] ?? IconWorld
                        return (
                            <Reveal key={key} delay={(index % 3) * 90}>
                                <div className="h-full rounded-3xl border border-border bg-card p-6 transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-md">
                                    <div className="flex size-10 items-center justify-center rounded-2xl bg-(--brand-orange)/10 text-(--brand-orange)">
                                        <Icon className="size-5" aria-hidden />
                                    </div>
                                    <h3 className="mt-4 font-semibold leading-snug">{t(`features.${key}.title`)}</h3>
                                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                        {t(`features.${key}.description`)}
                                    </p>
                                </div>
                            </Reveal>
                        )
                    })}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {highlights.map(({ key, Icon }, index) => (
                        <Reveal key={key} delay={index * 90}>
                            <div className="flex items-center gap-4 rounded-3xl bg-muted p-6">
                                <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-(--brand-red)/10 text-(--brand-red)">
                                    <Icon className="size-5.5" aria-hidden />
                                </div>
                                {/* Old dictionaries only carry a real title here */}
                                <h3 className="font-semibold leading-snug">{audienceMessages[key]?.title}</h3>
                            </div>
                        </Reveal>
                    ))}
                </div>
            </section>

            {videos.length > 0 && (
                <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-20">
                    <SectionHeading title={t("how_to.title")} subtitle={t("how_to.description")} />
                    <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {videos.map(([key, video], index) => (
                            <Reveal key={key} delay={index * 90}>
                                <a
                                    href={toWatchUrl(video.link)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="group flex items-center gap-4 rounded-3xl border border-border bg-card p-5 transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-md"
                                >
                                    <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-(--brand-red)/10 text-(--brand-red) transition-colors group-hover:bg-(--brand-red) group-hover:text-white">
                                        <IconBrandYoutubeFilled className="size-5.5" aria-hidden />
                                    </span>
                                    <span className="font-medium leading-snug">{video.title}</span>
                                </a>
                            </Reveal>
                        ))}
                    </div>
                </section>
            )}

            <CtaBand />
        </>
    )
}
