import { AudiencePage } from "@/frontend/pages/audience/audience-page"
import { pageMetadata } from "@/lib/seo"

export async function generateMetadata({
    params,
}: {
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params
    return pageMetadata(locale, "/carrier", "carrier")
}

export default function CarrierPage() {
    return <AudiencePage audience="carrier" />
}
