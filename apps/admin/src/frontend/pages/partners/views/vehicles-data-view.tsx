"use client"

import { useSearchParams } from "next/navigation"
import { useSuspenseInfiniteQuery } from "@tanstack/react-query"

import { useIsMobile } from "@workspace/ui/hooks/use-mobile"

import { useTRPC } from "@/backend/api/client"
import { today } from "@/lib/kyc/derive"
import { KycReviewSheet } from "@/frontend/pages/kyc/views/kyc-review-sheet"
import { VehicleRow } from "@/frontend/pages/partners/cards/vehicle-row"
import { PartnersList } from "@/frontend/pages/partners/views/partners-list"
import { currentView, vehiclesListInput } from "@/frontend/pages/partners/types"

export function VehiclesDataView() {
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const isMobile = useIsMobile()

    const view = isMobile ? "grid" : currentView((key) => searchParams.get(key))
    const input = vehiclesListInput((key) => searchParams.get(key))

    const query = useSuspenseInfiniteQuery(
        trpc.partners.vehicles.infiniteQueryOptions(input, {
            getNextPageParam: (lastPage) => lastPage.nextCursor,
        }),
    )

    const items = query.data.pages.flatMap((page) => page.items)
    const on = today()

    return (
        <>
            <PartnersList
                items={items}
                view={view}
                hasNextPage={query.hasNextPage}
                isFetchingNextPage={query.isFetchingNextPage}
                fetchNextPage={query.fetchNextPage}
                isFiltered={Boolean(input.search || input.status)}
                getKey={(item) => item.id}
            >
                {(item) => <VehicleRow vehicle={item} view={view} today={on} />}
            </PartnersList>

            <KycReviewSheet />
        </>
    )
}
