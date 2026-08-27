import { getPublicMetrics } from "@/lib/metrics"
import { pageMetadata } from "@/lib/seo"
import { Hero } from "@/frontend/pages/home/hero"
import { Reviews } from "@/frontend/pages/home/reviews"
import { Features } from "@/frontend/pages/home/features"
import { CtaBand } from "@/frontend/components/sections/cta-band"
import { PartnersMarquee } from "@/frontend/pages/home/partners-marquee"

// ISR: the page (and with it the database aggregates) refreshes hourly —
// visitors always get a static page, the database sees ≤ 1 query batch/hour
export const revalidate = 3600

export async function generateMetadata({
    params,
}: {
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params
    return pageMetadata(locale, "/")
}

export default async function HomePage() {
    const metrics = await getPublicMetrics()

    return (
        <>
            <Hero metrics={metrics} />
            <PartnersMarquee />
            <Features />
            <Reviews />
            <CtaBand />
        </>
    )
}
