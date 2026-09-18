import {
    IconHeadset,
    IconBuilding,
    IconBriefcase,
    IconMail,
    IconMapPin,
    type Icon as TablerIcon,
} from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { CONTACT } from "@/content/site"
import { Reveal } from "@/components/motion/reveal"
import { PageHero } from "@/frontend/components/sections/page-hero"
import { CtaBand } from "@/frontend/components/sections/cta-band"

const LINES: { key: "support" | "administration" | "sales"; number: string; Icon: TablerIcon }[] = [
    { key: "support", number: CONTACT.lines.support, Icon: IconHeadset },
    { key: "administration", number: CONTACT.lines.administration, Icon: IconBuilding },
    { key: "sales", number: CONTACT.lines.sales, Icon: IconBriefcase },
]

export function ContactView() {
    const t = useTranslations("contact")
    const tLines = useTranslations("contact_lines")

    return (
        <>
            <PageHero title={t("title")} subtitle={t("subtitle")} />

            <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {LINES.map(({ key, number, Icon }, index) => (
                        <Reveal key={key} delay={index * 90}>
                            <a
                                href={`tel:${number.replace(/\s/g, "")}`}
                                className="group block h-full rounded-3xl border border-border bg-card p-6 transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-md"
                            >
                                <div className="flex size-11 items-center justify-center rounded-2xl bg-(--brand-orange)/10 text-(--brand-orange) transition-colors group-hover:bg-(--brand-orange) group-hover:text-white">
                                    <Icon className="size-5.5" aria-hidden />
                                </div>
                                <h2 className="mt-4 text-sm font-medium text-muted-foreground">{tLines(key)}</h2>
                                <p className="mt-1 text-lg font-semibold tabular-nums">{number}</p>
                            </a>
                        </Reveal>
                    ))}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Reveal>
                        <a
                            href={`mailto:${CONTACT.email}`}
                            className="group flex h-full items-center gap-4 rounded-3xl bg-muted p-6 transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-md"
                        >
                            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-(--brand-red)/10 text-(--brand-red)">
                                <IconMail className="size-5.5" aria-hidden />
                            </span>
                            <span>
                                <span className="block text-sm font-medium text-muted-foreground">{tLines("email_title")}</span>
                                <span className="block font-semibold">{CONTACT.email}</span>
                            </span>
                        </a>
                    </Reveal>
                    <Reveal delay={90}>
                        <a
                            href={CONTACT.addressUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="group flex h-full items-center gap-4 rounded-3xl bg-muted p-6 transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-md"
                        >
                            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-(--brand-red)/10 text-(--brand-red)">
                                <IconMapPin className="size-5.5" aria-hidden />
                            </span>
                            <span>
                                <span className="block text-sm font-medium text-muted-foreground">{tLines("address_title")}</span>
                                <span className="block font-semibold">{CONTACT.address}</span>
                            </span>
                        </a>
                    </Reveal>
                </div>
            </section>

            <CtaBand />
        </>
    )
}
