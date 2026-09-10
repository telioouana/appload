"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { useTRPC } from "@/backend/api/client"
import { MoneyCard } from "@/frontend/pages/analytics/sections/money-card"
import { yearInput } from "@/frontend/pages/dashboard/types"

/**
 * What the year still owes and what it has settled, on the tenant's own leg,
 * in the analytics page's own card — same year as the chart beside it.
 */
export function YearMoney() {
    const trpc = useTRPC()

    const { data } = useSuspenseQuery(trpc.analytics.money.queryOptions(yearInput()))

    return <MoneyCard data={data} className="h-full" />
}
