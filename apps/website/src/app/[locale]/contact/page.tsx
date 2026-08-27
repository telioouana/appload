import { ContactView } from "@/frontend/pages/contact/contact-view"
import { pageMetadata } from "@/lib/seo"

export async function generateMetadata({
    params,
}: {
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params
    return pageMetadata(locale, "/contact", "contact")
}

export default function ContactPage() {
    return <ContactView />
}
