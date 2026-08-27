import type { MetadataRoute } from "next"

import { routing } from "@/i18n/routing"
import { languageAlternates, localizedUrl, type AppPathname } from "@/lib/seo"

const PATHNAMES = Object.keys(routing.pathnames) as AppPathname[]

// One entry per locale per route, each carrying the full reciprocal
// hreflang set (Google's documented sitemap format for localized pages).
// No lastModified/priority: Google ignores priority and distrusts
// inaccurate dates.
export default function sitemap(): MetadataRoute.Sitemap {
    return PATHNAMES.flatMap((pathname) =>
        routing.locales.map((locale) => ({
            url: localizedUrl(pathname, locale),
            alternates: { languages: languageAlternates(pathname) },
        })),
    )
}
