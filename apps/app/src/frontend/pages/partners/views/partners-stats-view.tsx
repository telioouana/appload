"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { IconInbox, IconSend, IconUsersGroup } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"
import { AttentionTiles, type AttentionTile } from "@workspace/ui/customs/list/attention-tiles"
import { tabsFor } from "@/frontend/pages/partners/types"

/**
 * The work queue above the list: requests waiting on an answer, requests
 * waiting on someone else, and everyone already connected. Each tile opens
 * exactly the rows it counted.
 */
export function PartnersStatsView() {
    const t = useTranslations("App.partners.tiles")
    const trpc = useTRPC()

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const { data: stats } = useSuspenseQuery(trpc.partners.stats.queryOptions())

    const connectedTab = tabsFor(session.organization.type)[0] as string

    const tiles: AttentionTile[] = [
        {
            filter: { key: "direction", value: "incoming" },
            label: t("incoming"),
            value: stats.incoming,
            hint: t("incoming-hint"),
            Icon: IconInbox,
        },
        {
            filter: { key: "direction", value: "outgoing" },
            label: t("outgoing"),
            value: stats.outgoing,
            hint: t("outgoing-hint"),
            Icon: IconSend,
        },
        {
            filter: { key: "tab", value: connectedTab },
            label: t("connected"),
            value: stats.accepted["client-carrier"] + stats.accepted.subcontract,
            hint: t("connected-hint"),
            Icon: IconUsersGroup,
        },
    ]

    // The open profile belongs to the list being left, and the direction
    // tiles are a slice of the requests tab rather than of the current one
    return <AttentionTiles tiles={tiles} reset={["id", "sel", "tab"]} />
}
