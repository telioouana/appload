"use client"

import { useSearchParams } from "next/navigation"
import { useSuspenseInfiniteQuery } from "@tanstack/react-query"

import { useIsMobile } from "@workspace/ui/hooks/use-mobile"

import { useTRPC } from "@/backend/api/client"
import { today } from "@/lib/kyc/derive"
import { KycReviewSheet } from "@/frontend/pages/kyc/views/kyc-review-sheet"
import { DriverRow } from "@/frontend/pages/partners/cards/driver-row"
import { PartnersList } from "@/frontend/pages/partners/views/partners-list"
import { currentView, partnersListInput } from "@/frontend/pages/partners/types"

export function DriversDataView() {
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const isMobile = useIsMobile()

    const view = isMobile ? "grid" : currentView((key) => searchParams.get(key))
    const input = partnersListInput((key) => searchParams.get(key))

    const query = useSuspenseInfiniteQuery(
        trpc.partners.drivers.infiniteQueryOptions(input, {
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
                {(item) => <DriverRow driver={item} view={view} today={on} />}
            </PartnersList>

            <KycReviewSheet />
        </>
    )
}
