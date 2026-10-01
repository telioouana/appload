"use client"

import { IconArrowUpRight, IconHeadset } from "@tabler/icons-react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { useFormatter, useTranslations } from "@workspace/i18n";

import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Spinner } from "@workspace/ui/components/spinner";

import { Link } from "@/i18n/navigation";
import { useTRPC } from "@/backend/api/client";

/**
 * The company's own record of what was done in its name: every change a
 * member made on the portal, and every time Appload support read its loads
 * under a grant (Settings › Security). Newest first, a page at a time. The
 * action is read in plain words where the portal knows the words, and as
 * the raw key where it does not — a key is still a fact.
 */
export function ActivityCard() {
    const t = useTranslations("App.settings.activity")
    const f = useFormatter()
    const trpc = useTRPC()

    const query = useInfiniteQuery(trpc.me.activity.list.infiniteQueryOptions(
        { limit: 30 },
        { getNextPageParam: (page) => page.nextCursor ?? undefined },
    ))

    const rows = query.data?.pages.flatMap((page) => page.items) ?? []

    const label = (action: string) => {
        const key = `actions.${action.replace(/\./g, "-")}`
        return t.has(key) ? t(key) : action
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("title")}</CardTitle>
                <CardDescription>{t("description")}</CardDescription>
            </CardHeader>

            <CardContent className="grid gap-4">
                {query.isPending ? (
                    <div className="flex justify-center py-8"><Spinner className="size-5" /></div>
                ) : query.isError ? (
                    <p className="text-destructive text-sm">{t("failed")}</p>
                ) : rows.length === 0 ? (
                    <p className="text-muted-foreground py-8 text-center text-sm">{t("empty")}</p>
                ) : (
                    <ul className="flex flex-col">
                        {rows.map((row) => (
                            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t py-2.5 text-[13px] first:border-t-0">
                                <span className="text-muted-foreground w-36 shrink-0 text-xs tabular-nums">
                                    {f.dateTime(row.createdAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                                </span>
                                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                                    {row.support
                                        ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-px text-[11px] leading-4 text-amber-700 dark:text-amber-400"><IconHeadset className="size-3" stroke={1.5} />{t("support")}</span>
                                        : <span className="shrink-0 font-medium">{row.actorName ?? "—"}</span>}
                                    <span className="truncate">{label(row.action)}</span>
                                    {row.status === "error" && <span className="text-destructive shrink-0 text-xs">{t("failed-action")}</span>}
                                </span>
                                {row.entityType === "movement" && row.entityId && (
                                    <Link href={{ pathname: "/orders/load/[loadId]", params: { loadId: row.entityId } }} className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-0.5 text-xs">
                                        {t("open-load")}<IconArrowUpRight className="size-3" stroke={1.5} />
                                    </Link>
                                )}
                                {row.entityType === "contract" && row.entityId && (
                                    <Link href={{ pathname: "/orders/multi/[orderId]", params: { orderId: row.entityId } }} className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-0.5 text-xs">
                                        {t("open-contract")}<IconArrowUpRight className="size-3" stroke={1.5} />
                                    </Link>
                                )}
                            </li>
                        ))}
                    </ul>
                )}

                {query.hasNextPage && (
                    <Button variant="outline" size="sm" className="w-fit" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
                        {query.isFetchingNextPage && <Spinner className="size-4" />}
                        {t("more")}
                    </Button>
                )}

                <p className="text-muted-foreground text-xs">{t("since")}</p>
            </CardContent>
        </Card>
    )
}
