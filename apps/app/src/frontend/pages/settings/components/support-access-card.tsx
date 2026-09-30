"use client"

import { useState } from "react";
import { toast } from "sonner";
import { IconLockOpen, IconShieldLock } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useFormatter, useTranslations } from "@workspace/i18n";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog";
import { Label } from "@workspace/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Spinner } from "@workspace/ui/components/spinner";
import { Textarea } from "@workspace/ui/components/textarea";

import { useTRPC } from "@/backend/api/client";

const DAYS = ["1", "7", "30"] as const;

/**
 * The company's door to Appload support: closed unless an owner opens it,
 * for a day, a week or a month, with a reason on record. While it is open,
 * staff can read this company's loads to help with them — nothing more, and
 * nothing of the companies it works with beyond what those loads say. The
 * history under it is the company's own record of who was let in and when.
 */
export function SupportAccessCard({ canManage }: { canManage: boolean }) {
    const t = useTranslations("App.settings.support")
    const f = useFormatter()
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const { data, isPending } = useQuery(trpc.me.supportGrants.list.queryOptions())

    const [open, setOpen] = useState(false)
    const [days, setDays] = useState<(typeof DAYS)[number]>("7")
    const [reason, setReason] = useState("")

    const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.me.supportGrants.list.queryKey() })

    const grant = useMutation(trpc.me.supportGrants.grant.mutationOptions({
        onSuccess: async () => {
            toast.success(t("granted"))
            setOpen(false)
            setReason("")
            await refresh()
        },
        onError: () => toast.error(t("failed")),
    }))
    const revoke = useMutation(trpc.me.supportGrants.revoke.mutationOptions({
        onSuccess: async () => {
            toast.success(t("revoked"))
            await refresh()
        },
        onError: () => toast.error(t("failed")),
    }))

    const active = data?.active ?? null
    const when = (date: Date) => f.dateTime(date, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("title")}</CardTitle>
                <CardDescription>{t("description")}</CardDescription>
            </CardHeader>

            <CardContent className="grid gap-6">
                <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                        {active ? <IconLockOpen className="size-5 shrink-0 text-amber-600 dark:text-amber-400" stroke={1.5} /> : <IconShieldLock className="text-muted-foreground size-5 shrink-0" stroke={1.5} />}
                        <div className="flex min-w-0 flex-col">
                            <span className="text-sm font-medium">{isPending ? t("loading") : active ? t("open-until", { date: when(active.expiresAt) }) : t("closed")}</span>
                            {active && (
                                <span className="text-muted-foreground truncate text-xs">
                                    {t("granted-by", { name: active.grantedByName ?? "—" })} · {active.reason}
                                </span>
                            )}
                        </div>
                    </div>

                    {canManage && (
                        active ? (
                            <Button size="sm" variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate({ id: active.id })}>
                                {revoke.isPending && <Spinner className="size-4" />}
                                {t("revoke")}
                            </Button>
                        ) : (
                            <Button size="sm" onClick={() => setOpen(true)}>{t("grant")}</Button>
                        )
                    )}
                </div>

                <p className="text-muted-foreground text-xs">{t("what-they-see")}</p>

                {data && data.history.length > 0 && (
                    <div className="grid gap-2">
                        <span className="text-sm font-medium">{t("history")}</span>
                        <ul className="flex flex-col">
                            {data.history.map((row) => (
                                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-[13px] first:border-t-0">
                                    <span className="min-w-0 flex-1 truncate">
                                        <span className="font-medium">{row.grantedByName ?? "—"}</span>
                                        <span className="text-muted-foreground"> · {row.reason}</span>
                                    </span>
                                    <span className="text-muted-foreground text-xs tabular-nums">
                                        {when(row.createdAt)} → {when(row.expiresAt)}
                                    </span>
                                    <Badge variant={row.state === "active" ? "default" : "secondary"}>{t(`states.${row.state}`)}</Badge>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </CardContent>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t("dialog.title")}</DialogTitle>
                        <DialogDescription>{t("dialog.description")}</DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="support-days">{t("dialog.duration")}</Label>
                            <Select value={days} onValueChange={(value) => setDays(value as (typeof DAYS)[number])}>
                                <SelectTrigger id="support-days" className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {DAYS.map((value) => (
                                        <SelectItem key={value} value={value}>{t(`dialog.days.${value}`)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="support-reason">{t("dialog.reason")}</Label>
                            <Textarea
                                id="support-reason"
                                value={reason}
                                onChange={(event) => setReason(event.target.value)}
                                placeholder={t("dialog.reason-placeholder")}
                                maxLength={300}
                                rows={3}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>{t("dialog.cancel")}</Button>
                        <Button
                            disabled={reason.trim().length < 3 || grant.isPending}
                            onClick={() => grant.mutate({ days: Number(days) as 1 | 7 | 30, reason: reason.trim() })}
                        >
                            {grant.isPending && <Spinner className="size-4" />}
                            {t("dialog.confirm")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    )
}
