import Image from "next/image"

import { useTranslations } from "@workspace/i18n"
import { Button } from "@workspace/ui/components/button"

import { Link } from "@/i18n/navigation"
import { Reveal } from "@/components/motion/reveal"

export function CtaBand() {
    const t = useTranslations("try_appload")
    const tFooter = useTranslations("footer")

    return (
        <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24">
            <Reveal>
                <div className="relative overflow-hidden rounded-3xl bg-(--brand-red)">
                    {/* The old site's red-duotone truck shot, made for this surface */}
                    <Image
                        src="/banners/home-banner.png"
                        alt=""
                        aria-hidden
                        fill
                        quality={65}
                        sizes="(max-width: 1152px) 100vw, 1152px"
                        className="object-cover object-[center_60%] opacity-25"
                    />
                    <div className="relative flex flex-col items-start justify-between gap-6 p-8 sm:flex-row sm:items-center sm:p-12">
                        <h2 className="font-heading text-2xl font-bold tracking-tight text-white sm:text-3xl">
                            {t("part1")} {t("part2")}
                        </h2>
                        <Button
                            asChild
                            size="lg"
                            className="bg-white text-(--brand-red) hover:bg-white/85"
                        >
                            <Link href="/contact">{tFooter("reach.title")}</Link>
                        </Button>
                    </div>
                </div>
            </Reveal>
        </section>
    )
}
