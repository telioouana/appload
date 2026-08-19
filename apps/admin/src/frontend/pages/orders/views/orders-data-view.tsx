"use client"

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";

import { useTranslations } from "@workspace/i18n";

import { Spinner } from "@workspace/ui/components/spinner";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";

import { cn } from "@workspace/ui/lib/utils";

import { useTRPC } from "@/backend/api/client";
import { OrderListRow } from "@/frontend/pages/orders/cards/order-list-row";
import { VIEW, FILTER, ordersListInput } from "@/frontend/pages/orders/types";
import { OrderGridCard } from "@/frontend/pages/orders/cards/order-grid-card";
import { UpdateOrderView } from "@/frontend/pages/order/views/update-order-view";

type DataTypes = {
    filter: FILTER
}

export function OrdersDataView({ filter }: DataTypes) {
    const t = useTranslations("Admin.orders.data");

    const trpc = useTRPC();
    const searchParams = useSearchParams();
    const isMobile = useIsMobile();

    // The list-row grid tracks don't fit small screens; mobile always gets
    // the card grid and the header hides the view toggle there
    const view: VIEW = isMobile ? "grid" : ((searchParams.get("view") as VIEW) ?? "list");

    // Same URL contract the header writes; the query key derives from these,
    // so any (debounced) URL change refetches automatically. Suspends into the
    // page's <Suspense> boundary while the first page loads.
    const ordersQuery = useSuspenseInfiniteQuery(
        trpc.orders.list.infiniteQueryOptions(
            ordersListInput(filter, (key) => searchParams.get(key)),
            {
                getNextPageParam: (lastPage) => lastPage.nextCursor,
            },
        ),
    );

    const { hasNextPage, isFetchingNextPage, fetchNextPage } = ordersQuery;

    // Sentinel-driven infinite scroll: fetch the next page shortly before
    // the end of the list enters the viewport
    const sentinelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = sentinelRef.current
        if (!el) return

        const observer = new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
                fetchNextPage()
            }
        }, { rootMargin: "200px" })

        observer.observe(el)
        return () => observer.disconnect()
    }, [hasNextPage, isFetchingNextPage, fetchNextPage])

    const pages = ordersQuery.data.pages;
    const orders = pages.flatMap((page) => page.items);

    return (
        <>
            {orders.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-10">{t("empty")}</p>
            ) : (
                <>
                    <div className={cn(
                        view === "grid"
                            ? "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
                            // List rows wrap their inner grid below md, so
                            // no sideways scrolling is needed
                            : "flex flex-col gap-4"
                    )}>
                        {orders.map((item) => (
                            view === "grid"
                                ? <OrderGridCard key={item.id} order={item} />
                                : <OrderListRow key={item.id} order={item} />
                        ))}
                    </div>

                    {hasNextPage && (
                        <div ref={sentinelRef} className="flex justify-center py-2">
                            {isFetchingNextPage && <Spinner className="text-primary" />}
                        </div>
                    )}
                </>
            )}

            {/* Single Sheet instance shared by every row/card's View button */}
            <UpdateOrderView />
        </>
    )
}
