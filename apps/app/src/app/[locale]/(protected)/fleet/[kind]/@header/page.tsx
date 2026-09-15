import { notFound } from "next/navigation"

import { FleetHeaderView } from "@/frontend/pages/fleet/views/fleet-header-view"
import { kindFromSlug } from "@/frontend/pages/fleet/types"

export default async function Header({ params }: { params: Promise<{ kind: string }> }) {
    const { kind } = await params
    const vehicle = kindFromSlug(kind)

    if (!vehicle) notFound()

    return <FleetHeaderView kind={vehicle} />
}
