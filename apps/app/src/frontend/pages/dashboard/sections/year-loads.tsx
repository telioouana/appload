"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { useTRPC } from "@/backend/api/client"
import { LoadsCard } from "@/frontend/pages/analytics/sections/loads-card"
import { yearInput } from "@/frontend/pages/dashboard/types"

/**
 * The year of the company's own loads, in the analytics page's own card:
 * what they are to bring in and cost, and the margin on the ones that
 * arrived — same year as the chart below.
 */
export function YearLoads() {
    const trpc = useTRPC()

    const { data } = useSuspenseQuery(trpc.analytics.loads.queryOptions(yearInput()))

    return <LoadsCard data={data} />
}
