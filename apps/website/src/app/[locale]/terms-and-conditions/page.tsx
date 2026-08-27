import { LegalPage } from "@/frontend/pages/legal/legal-page"
import { pageMetadata } from "@/lib/seo"

export async function generateMetadata({
    params,
}: {
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params
    return pageMetadata(locale, "/terms-and-conditions", "terms")
}

export default function TermsPage() {
    return <LegalPage namespace="terms" />
}
