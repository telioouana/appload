import type { Metadata } from "next"

import { hasLocale, type Locale } from "@workspace/i18n"
import { getTranslations } from "@workspace/i18n/server"

import { getPathname } from "@/i18n/navigation"
import { routing } from "@/i18n/routing"

// Canonical origin: env-configurable so previews can override, defaulting
// to production (relative metadata URLs resolve against this)
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://appload.co.mz"
export const SITE_NAME = "Appload"

export type AppPathname = keyof typeof routing.pathnames

// Keys into the `metadata` message namespace (title/description pairs)
type MetadataKey =
    | "shipper"
    | "carrier"
    | "team"
    | "contact"
    | "faq"
    | "insurance"
    | "terms"
    | "privacy"

const OG_LOCALES: Record<Locale, string> = { pt: "pt_MZ", en: "en_US" }

// The brand card served by src/app/opengraph-image.tsx. Referenced
// explicitly because per-page openGraph config replaces (not merges) the
// root file convention's og:image. Relative URLs resolve via metadataBase.
export const OG_IMAGE_ALT = "Appload — digital freight marketplace for Mozambique and SADC"
const OG_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: OG_IMAGE_ALT }

export function localizedUrl(pathname: AppPathname, locale: Locale) {
    return SITE_URL + getPathname({ href: pathname, locale })
}

// hreflang set for one page; x-default points at the pt version, which
// owns the unprefixed URLs
export function languageAlternates(pathname: AppPathname) {
    return {
        pt: localizedUrl(pathname, "pt"),
        en: localizedUrl(pathname, "en"),
        "x-default": localizedUrl(pathname, routing.defaultLocale),
    }
}

/**
 * Canonical + hreflang + Open Graph/Twitter metadata for one page.
 * Without `messageKey` it describes the homepage: root title/description
 * and an absolute title (the layout template would double the brand).
 * og:image comes from the root opengraph-image file convention.
 */
export async function pageMetadata(
    requestedLocale: string,
    pathname: AppPathname,
    messageKey?: MetadataKey,
): Promise<Metadata> {
    const locale = hasLocale(routing.locales, requestedLocale)
        ? requestedLocale
        : routing.defaultLocale
    const t = await getTranslations({ locale, namespace: "metadata" })
    // Keys are built dynamically, which next-intl's strict typing can't follow
    const tKey = t as unknown as (key: string) => string
    const title = messageKey ? tKey(`${messageKey}.title`) : tKey("title")
    const description = messageKey ? tKey(`${messageKey}.description`) : tKey("description")
    const canonical = localizedUrl(pathname, locale)

    return {
        title: messageKey ? title : { absolute: title },
        description,
        alternates: {
            canonical,
            languages: languageAlternates(pathname),
        },
        openGraph: {
            type: "website",
            siteName: SITE_NAME,
            url: canonical,
            title,
            description,
            locale: OG_LOCALES[locale],
            alternateLocale: routing.locales
                .filter((other) => other !== locale)
                .map((other) => OG_LOCALES[other]),
            images: [OG_IMAGE],
        },
        twitter: {
            card: "summary_large_image",
            title,
            description,
            images: ["/twitter-image"],
        },
    }
}
