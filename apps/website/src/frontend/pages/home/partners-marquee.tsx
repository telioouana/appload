import Image from "next/image"

import { useTranslations } from "@workspace/i18n"

import { PARTNERS } from "@/content/site"
import { Reveal } from "@/components/motion/reveal"

export function PartnersMarquee() {
    const t = useTranslations("home")

    return (
        <section className="py-14 sm:py-16">
            <Reveal>
                <p className="mb-8 text-center text-sm font-medium uppercase tracking-widest text-muted-foreground">
                    {t("partners")}
                </p>
            </Reveal>
            <div className="marquee relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
                <div className="marquee-track flex w-max items-center">
                    {[0, 1].map((copy) => (
                        <div key={copy} className="flex items-center" aria-hidden={copy === 1}>
                            {PARTNERS.map((partner) => (
                                <div key={`${copy}-${partner.name}`} className="mx-8 flex h-12 w-28 items-center justify-center sm:mx-10">
                                    <Image
                                        src={partner.src}
                                        alt={partner.name}
                                        width={112}
                                        height={48}
                                        className="max-h-10 w-auto object-contain opacity-60 grayscale transition-[opacity,filter] duration-300 hover:opacity-100 hover:grayscale-0 dark:opacity-70 dark:invert dark:hover:opacity-100 dark:hover:grayscale"
                                    />
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}
