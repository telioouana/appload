import Image from "next/image"
import {
    IconBrandFacebook,
    IconBrandInstagram,
    IconBrandLinkedin,
    IconBrandYoutube,
    IconMail,
    IconMapPin,
} from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Link } from "@/i18n/navigation"
import { CONTACT, SOCIALS } from "@/content/site"

const SOCIAL_ICONS = [
    { key: "linkedin", href: SOCIALS.linkedin, Icon: IconBrandLinkedin },
    { key: "facebook", href: SOCIALS.facebook, Icon: IconBrandFacebook },
    { key: "instagram", href: SOCIALS.instagram, Icon: IconBrandInstagram },
    { key: "youtube", href: SOCIALS.youtube, Icon: IconBrandYoutube },
] as const;

export function SiteFooter() {
    const t = useTranslations("footer")
    const tNav = useTranslations("navigation")
    const tMeta = useTranslations("metadata")

    return (
        <footer className="bg-(--canvas) text-white">
            <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
                <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-4">
                        <Image src="/logo-white.svg" alt="Appload" width={140} height={40} className="h-9 w-auto" />
                        <p className="max-w-xs text-sm leading-relaxed text-(--canvas-muted)">
                            {tMeta("description")}
                        </p>
                        <div className="flex gap-2">
                            {SOCIAL_ICONS.map(({ key, href, Icon }) => (
                                <a
                                    key={key}
                                    href={href}
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label={t(`reach.${key}`)}
                                    className="flex size-9 items-center justify-center rounded-3xl border border-(--canvas-border) text-(--canvas-muted) transition-colors hover:border-(--brand-orange) hover:text-(--brand-orange)"
                                >
                                    <Icon className="size-4.5" />
                                </a>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-(--canvas-faint)">
                            {t("company.title")}
                        </h3>
                        <ul className="space-y-2.5 text-sm text-(--canvas-muted)">
                            <li><Link href="/team" className="transition-colors hover:text-white">{t("company.team")}</Link></li>
                            <li><Link href="/contact" className="transition-colors hover:text-white">{t("company.contact")}</Link></li>
                        </ul>

                        <h3 className="mt-8 mb-4 text-sm font-semibold uppercase tracking-wide text-(--canvas-faint)">
                            {t("legal.title")}
                        </h3>
                        <ul className="space-y-2.5 text-sm text-(--canvas-muted)">
                            <li><Link href="/terms-and-conditions" className="transition-colors hover:text-white">{t("legal.terms_and_conditions")}</Link></li>
                            <li><Link href="/privacy-policy" className="transition-colors hover:text-white">{t("legal.privacy_policy")}</Link></li>
                        </ul>
                    </div>

                    <div>
                        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-(--canvas-faint)">
                            {t("quick_links.title")}
                        </h3>
                        <ul className="space-y-2.5 text-sm text-(--canvas-muted)">
                            <li><Link href="/faq" className="transition-colors hover:text-white">{t("quick_links.faq")}</Link></li>
                            <li><Link href="/insurance" className="transition-colors hover:text-white">{t("quick_links.insurance")}</Link></li>
                            <li><Link href="/shipper" className="transition-colors hover:text-white">{tNav("shipper")}</Link></li>
                            <li><Link href="/carrier" className="transition-colors hover:text-white">{tNav("carrier")}</Link></li>
                        </ul>
                    </div>

                    <div>
                        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-(--canvas-faint)">
                            {t("reach.title")}
                        </h3>
                        <ul className="space-y-3 text-sm text-(--canvas-muted)">
                            <li>
                                <a href={`mailto:${CONTACT.email}`} className="flex items-start gap-2.5 transition-colors hover:text-white">
                                    <IconMail className="mt-0.5 size-4 shrink-0" />
                                    {CONTACT.email}
                                </a>
                            </li>
                            <li>
                                <a href={CONTACT.addressUrl} target="_blank" rel="noreferrer" className="flex items-start gap-2.5 transition-colors hover:text-white">
                                    <IconMapPin className="mt-0.5 size-4 shrink-0" />
                                    {CONTACT.address}
                                </a>
                            </li>
                        </ul>
                    </div>
                </div>

                <div className="mt-12 border-t border-(--canvas-border) pt-6 text-sm text-(--canvas-faint)">
                    © {new Date().getFullYear()} {t("copyright.company")}, {t("copyright.text")}
                </div>
            </div>
        </footer>
    )
}
