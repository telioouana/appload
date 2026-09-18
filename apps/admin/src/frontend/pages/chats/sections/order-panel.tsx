"use client";

import { useQuery } from "@tanstack/react-query";
import { IconClipboardOff, IconExternalLink, IconX } from "@tabler/icons-react";

import { useFormatter, useTranslations } from "@workspace/i18n";

import { Button } from "@workspace/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty";
import { Skeleton } from "@workspace/ui/components/skeleton";

import { useTRPC } from "@/backend/api/client";
import { Link } from "@/i18n/navigation";
import { OrderStatusBadge, place } from "@/frontend/pages/orders/sections/order-item-shared";

export function OrderPanel({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
    const t = useTranslations("Admin.messages.panel");
    const f = useFormatter();

    const trpc = useTRPC();
    const summaryQuery = useQuery(
        trpc.chats.orderSummary.queryOptions(
            { orderId: orderId ?? "" },
            { enabled: !!orderId, staleTime: 60_000 },
        ),
    );
    const summary = summaryQuery.data;

    return (
        <aside className="hidden w-72 shrink-0 flex-col border-l lg:flex">
            <div className="flex items-center justify-between gap-2 p-4 pb-2">
                <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
                    {t("title")}
                </span>
                <Button variant="ghost" size="icon-sm" onClick={onClose}>
                    <IconX />
                    <span className="sr-only">{t("close")}</span>
                </Button>
            </div>

            {!orderId || summaryQuery.isError ? (
                <Empty className="flex-1 py-10">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <IconClipboardOff />
                        </EmptyMedia>
                        <EmptyTitle>{t("noOrderTitle")}</EmptyTitle>
                        <EmptyDescription>{t("noOrderDescription")}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : !summary ? (
                <div className="flex flex-col gap-4 p-4">
                    <Skeleton className="h-6 w-2/3" />
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-16 w-full" />
                </div>
            ) : (
                <>
                    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4 pt-2">
                        <div className="flex flex-col items-start gap-1.5">
                            <span className="text-base font-bold tracking-tight">{summary.orderId}</span>
                            <OrderStatusBadge status={summary.status} className="px-1.5 py-0.5 text-xs" />
                        </div>

                        <div className="grid grid-cols-[0.875rem_1fr] gap-x-2.5">
                            <div className="flex flex-col items-center pt-1.5">
                                <span className="size-2 rounded-full bg-primary" />
                                <span className="my-1 min-h-6 w-0.5 flex-1 rounded-full bg-border" />
                                <span className="size-2 rounded-full border-2 border-primary" />
                            </div>
                            <div className="flex flex-col justify-between gap-4">
                                <div>
                                    <div className="text-sm font-semibold">{place(summary.loadingAddress)}</div>
                                    <div className="text-xs text-muted-foreground">
                                        {t("loading")}
                                        {" · "}
                                        {f.dateTime(summary.expectedLoadingDate, { day: "2-digit", month: "short" })}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-sm font-semibold">{place(summary.offloadingAddress)}</div>
                                    <div className="text-xs text-muted-foreground">
                                        {t("offloading")}
                                        {summary.expectedOffloadingDate && (
                                            <>
                                                {" · "}
                                                {f.dateTime(summary.expectedOffloadingDate, { day: "2-digit", month: "short" })}
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col rounded-xl border">
                            <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                                <span className="text-muted-foreground">{t("truck")}</span>
                                <span className="font-mono text-xs font-semibold tracking-wide">
                                    {summary.truckPlate ?? "—"}
                                </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-sm">
                                <span className="text-muted-foreground">{t("driver")}</span>
                                <span className="truncate font-semibold">{summary.driverName ?? "—"}</span>
                            </div>
                        </div>
                    </div>

                    <div className="p-4 pt-0">
                        <Button asChild variant="outline" className="w-full">
                            <Link href={{ pathname: "/orders/details/[orderId]", params: { orderId: summary.orderId } }}>
                                {t("viewOrder")}
                                <IconExternalLink />
                            </Link>
                        </Button>
                    </div>
                </>
            )}
        </aside>
    );
}
