"use client"

import { useTranslations } from "@workspace/i18n"

import { SectionCard } from "@workspace/ui/customs/detail/section-card"
import { HistoryTimeline } from "@/frontend/pages/orders/components/history-timeline"
import type { OrderHistoryEntry } from "@/frontend/pages/orders/types"

/** Everything that has happened to this order, newest first. */
export function TimelineCard({ entries }: { entries: OrderHistoryEntry[] }) {
    const t = useTranslations("App.orders.timeline")

    return (
        <SectionCard title={t("title")} count={entries.length}>
            <HistoryTimeline entries={entries} />
        </SectionCard>
    )
}
