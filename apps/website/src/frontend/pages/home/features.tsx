import {
    IconArrowRight,
    IconMapPin,
    IconPackage,
    IconShieldCheck,
    IconStar,
    IconTruck,
    IconWorld,
    type Icon as TablerIcon,
} from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Link } from "@/i18n/navigation"
import { Reveal } from "@/components/motion/reveal"
import { SectionHeading } from "@/frontend/components/sections/section-heading"

const FEATURE_ICONS: TablerIcon[] = [IconWorld, IconMapPin, IconShieldCheck, IconStar]

export function Features() {
    const t = useTranslations("home")
    const tNav = useTranslations("navigation")
    const tShipper = useTranslations("shipper")
    const tCarrier = useTranslations("carrier")

    const featureKeys = ["feature1", "feature2", "feature3", "feature4"] as const

    return (
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
            <SectionHeading
                chip={t("description.title.part2")}
                chipIcon={IconPackage}
                title={t("description.title.part1")}
                subtitle={t("description.body.part1")}
            />

            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {featureKeys.map((key, index) => {
                    const Icon = FEATURE_ICONS[index] ?? IconWorld
                    return (
                        <Reveal key={key} delay={index * 90}>
                            <div className="h-full rounded-3xl border border-border bg-card p-6 transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-md">
                                <div className="flex size-10 items-center justify-center rounded-2xl bg-(--brand-orange)/10 text-(--brand-orange)">
                                    <Icon className="size-5" aria-hidden />
                                </div>
                                <p className="mt-4 text-sm font-medium leading-relaxed text-foreground">
                                    {t(`features.${key}`)}
                                </p>
                            </div>
                        </Reveal>
                    )
                })}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Reveal delay={90}>
                    <Link
                        href="/shipper"
                        className="group block h-full rounded-3xl bg-muted p-7 transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-md sm:p-9"
                    >
                        <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-(--brand-orange)">
                            <IconPackage className="size-4" aria-hidden />
                            {tNav("shipper")}
                        </p>
                        <h3 className="mt-3 font-heading text-2xl font-bold tracking-tight">
                            {tShipper("title.part1")} {tShipper("title.part2")}
                        </h3>
                        <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                            {tShipper("description.body.part1")}
                        </p>
                        <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-(--brand-red)">
                            {t("button.shipper")}
                            <IconArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
                        </span>
                    </Link>
                </Reveal>
                <Reveal delay={180}>
                    <Link
                        href="/carrier"
                        className="group block h-full rounded-3xl bg-muted p-7 transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-md sm:p-9"
                    >
                        <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-(--brand-orange)">
                            <IconTruck className="size-4" aria-hidden />
                            {tNav("carrier")}
                        </p>
                        <h3 className="mt-3 font-heading text-2xl font-bold tracking-tight">
                            {tCarrier("title.part1")} {tCarrier("title.part2")}
                        </h3>
                        <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                            {tCarrier("description.body.part1")}
                        </p>
                        <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-(--brand-red)">
                            {t("button.carrier")}
                            <IconArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
                        </span>
                    </Link>
                </Reveal>
            </div>
        </section>
    )
}
