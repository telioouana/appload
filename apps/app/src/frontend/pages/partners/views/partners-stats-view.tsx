"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { IconInbox, IconSend } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Link } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import { AttentionTiles, type AttentionTile } from "@workspace/ui/customs/list/attention-tiles"
import type { PartnerListKind } from "@/frontend/pages/partners/types"

/**
 * The work queue above the list: requests waiting on an answer, and requests
 * waiting on someone else. On the requests list each tile filters it to
 * exactly the rows it counted; on the other lists the same tiles are links
 * into that slice of the requests, since a direction means nothing on a list
 * of connected partners.
 */
export function PartnersStatsView({ kind }: { kind: PartnerListKind }) {
    const t = useTranslations("App.partners.tiles")
    const trpc = useTRPC()

    const { data: stats } = useSuspenseQuery(trpc.partners.stats.queryOptions())

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
    ]

    // The open profile and the ticked rows belong to the list before it was narrowed
    if (kind === "requests") return <AttentionTiles tiles={tiles} reset={["id", "sel"]} />

    // The same tile face as AttentionTiles, never active: nothing on this
    // list is the slice it opens
    return (
        <div className="grid grid-cols-2 gap-3 px-2 xl:grid-cols-4">
            {tiles.map((tile) => (
                <Link
                    key={tile.filter.value}
                    href={{ pathname: "/partners/[kind]", params: { kind: "requests" }, query: { direction: tile.filter.value } }}
                    className="bg-card ring-foreground/5 hover:ring-primary/40 focus-visible:ring-ring/50 flex items-center gap-3 rounded-2xl px-4 py-3 text-left ring-1 transition-colors outline-none focus-visible:ring-3"
                >
                    <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-xl">
                        <tile.Icon className="size-4" stroke={1.5} />
                    </span>

                    <span className="flex min-w-0 flex-col">
                        <span className="text-muted-foreground truncate text-xs font-medium">{tile.label}</span>
                        <span className="text-xl leading-tight font-semibold tracking-tight tabular-nums">
                            {tile.value.toLocaleString()}
                        </span>
                        {tile.hint && <span className="text-muted-foreground truncate text-xs">{tile.hint}</span>}
                    </span>
                </Link>
            ))}
        </div>
    )
}
