"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { useTRPC } from "@/backend/api/client"
import { OrdersByMonth } from "@/frontend/pages/analytics/sections/orders-by-month"
import { yearInput } from "@/frontend/pages/dashboard/types"

/**
 * The year's loads, drawn by the analytics page's own chart. The card is
 * theirs; the only thing this page decides is the year, and it never asks
 * for another one.
 */
export function MonthlyOrders() {
    const trpc = useTRPC()

    const { data } = useSuspenseQuery(trpc.analytics.monthly.queryOptions(yearInput()))

    return <OrdersByMonth data={data} className="h-full" />
}
