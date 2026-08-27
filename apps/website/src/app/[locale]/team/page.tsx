import { TeamView } from "@/frontend/pages/team/team-view"
import { pageMetadata } from "@/lib/seo"

export async function generateMetadata({
    params,
}: {
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params
    return pageMetadata(locale, "/team", "team")
}

export default function TeamPage() {
    return <TeamView />
}
