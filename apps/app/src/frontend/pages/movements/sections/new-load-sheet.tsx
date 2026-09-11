"use client"

import { useQuery } from "@tanstack/react-query"

import { useTRPC } from "@/backend/api/client"
import { useNewLoad } from "@/frontend/pages/movements/hooks/use-new-load"
import { LoadSheet } from "@/frontend/pages/movements/sections/load-sheet"

/**
 * The one new-load sheet, mounted by the rail so it is there on every page:
 * the rail's own button, each list's header and the empty states all open
 * it through the store, on the shape they are about.
 */
export function NewLoadSheet() {
    const trpc = useTRPC()
    const { isOpen, execution, close } = useNewLoad()

    const { data: session } = useQuery(trpc.me.session.queryOptions())

    if (!session) return null

    return (
        <LoadSheet
            mode={{ kind: "create", execution }}
            orgType={session.organization.type}
            allowance={session.allowance}
            organizationName={session.organization.name}
            open={isOpen}
            onOpenChange={(next) => { if (!next) close() }}
        />
    )
}
