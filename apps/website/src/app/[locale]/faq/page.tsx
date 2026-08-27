import { getMessages } from "@workspace/i18n/server"

import { JsonLd } from "@/components/seo/json-ld"
import { FaqView } from "@/frontend/pages/faq/faq-view"
import { faqPageJsonLd } from "@/lib/json-ld"
import { pageMetadata } from "@/lib/seo"

export async function generateMetadata({
    params,
}: {
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params
    return pageMetadata(locale, "/faq", "faq")
}

export default async function FaqPage({
    params,
}: {
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params
    const messages = await getMessages({ locale })

    // Same collection FaqView renders: faqN entries across the three groups
    const entries = (["general", "shipper", "carrier"] as const).flatMap((groupKey) => {
        const group = messages.faq[groupKey] as Record<string, unknown>
        return Object.entries(group)
            .filter(
                (entry): entry is [string, { title: string; description: unknown }] =>
                    entry[0].startsWith("faq") && typeof entry[1] === "object" && entry[1] !== null,
            )
            .map(([, entry]) => ({ question: entry.title, answer: entry.description }))
    })

    return (
        <>
            <JsonLd data={faqPageJsonLd(entries)} />
            <FaqView />
        </>
    )
}
