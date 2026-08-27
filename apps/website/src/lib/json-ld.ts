// schema.org payloads, built from the locale-independent site data.
// Review/AggregateRating markup is deliberately absent: self-serving
// review snippets are against Google's structured-data policies.

import { CONTACT, SOCIALS } from "@/content/site"
import { SITE_NAME, SITE_URL } from "@/lib/seo"

const ORGANIZATION_ID = `${SITE_URL}/#organization`

export function organizationGraph() {
    return {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Organization",
                "@id": ORGANIZATION_ID,
                name: SITE_NAME,
                url: SITE_URL,
                logo: `${SITE_URL}/appload.png`,
                email: CONTACT.email,
                address: {
                    "@type": "PostalAddress",
                    streetAddress: "Avenida Paulo Samuel Kankhomba, 1063, Bairro Central",
                    addressLocality: "Maputo",
                    addressCountry: "MZ",
                },
                contactPoint: [
                    {
                        "@type": "ContactPoint",
                        telephone: CONTACT.lines.support,
                        contactType: "customer support",
                    },
                    {
                        "@type": "ContactPoint",
                        telephone: CONTACT.lines.sales,
                        contactType: "sales",
                    },
                ],
                sameAs: Object.values(SOCIALS),
            },
            {
                "@type": "WebSite",
                "@id": `${SITE_URL}/#website`,
                url: SITE_URL,
                name: SITE_NAME,
                publisher: { "@id": ORGANIZATION_ID },
            },
        ],
    }
}

/**
 * Flattens the ported rich-text message structures ({p1, p2}, {text, bold},
 * {info, bullet1..n}, nested combinations) to plain text, mirroring what
 * RichContent renders: `link` keys are skipped, bullets become "– " lines,
 * inline fragments join with spaces.
 */
export function flattenRichText(value: unknown): string {
    if (typeof value === "string") return value.trim()
    if (typeof value !== "object" || value === null) return ""

    const parts: string[] = []
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (key === "link") continue
        const text = flattenRichText(entry)
        if (text) parts.push(key.startsWith("bullet") ? `\n– ${text}` : text)
    }
    return parts.join(" ").trim()
}

export function faqPageJsonLd(entries: { question: string; answer: unknown }[]) {
    return {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: entries.map((entry) => ({
            "@type": "Question",
            name: entry.question,
            acceptedAnswer: {
                "@type": "Answer",
                text: flattenRichText(entry.answer),
            },
        })),
    }
}
