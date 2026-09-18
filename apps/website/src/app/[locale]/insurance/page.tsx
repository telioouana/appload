import { getMessages } from "@workspace/i18n/server"

import { JsonLd } from "@/components/seo/json-ld"
import { InsuranceView } from "@/frontend/pages/insurance/insurance-view"
import { faqPageJsonLd } from "@/lib/json-ld"
import { pageMetadata } from "@/lib/seo"

export async function generateMetadata({
    params,
}: {
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params
    return pageMetadata(locale, "/insurance", "insurance")
}

export default async function InsurancePage({
    params,
}: {
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params
    const messages = await getMessages({ locale })

    // Same collection InsuranceView renders: the namespace's faqN entries
    const entries = Object.entries(messages.insurance_faq as Record<string, unknown>)
        .filter(
            (entry): entry is [string, { question: string; answer: unknown }] =>
                entry[0].startsWith("faq") && typeof entry[1] === "object" && entry[1] !== null,
        )
        .map(([, entry]) => ({ question: entry.question, answer: entry.answer }))

    return (
        <>
            <JsonLd data={faqPageJsonLd(entries)} />
            <InsuranceView />
        </>
    )
}
