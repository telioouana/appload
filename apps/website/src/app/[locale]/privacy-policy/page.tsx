import { LegalPage } from "@/frontend/pages/legal/legal-page"
import { pageMetadata } from "@/lib/seo"

export async function generateMetadata({
    params,
}: {
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params
    return pageMetadata(locale, "/privacy-policy", "privacy")
}

export default function PrivacyPage() {
    return <LegalPage namespace="privacy" />
}
