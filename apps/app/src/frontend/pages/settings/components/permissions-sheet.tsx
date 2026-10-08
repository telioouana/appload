"use client"

import { toast } from "sonner";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconClock, IconCrown, IconRestore } from "@tabler/icons-react";

import { useFormatter, useNow, useTranslations } from "@workspace/i18n";
import { PERMISSION_GROUPS, type Permission } from "@workspace/auth/organization-permissions";
import type { OrgType } from "@workspace/trpc/tenant-gate";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Spinner } from "@workspace/ui/components/spinner";
import { Switch } from "@workspace/ui/components/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";

import { useTRPC } from "@/backend/api/client";
import { fromMaputoInput, profileKey, toMaputoInput } from "@/frontend/pages/settings/lib/profiles";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One person's permissions, line by line of the profiles matrix: what their
 * profile starts them with, what somebody above them switched on ("extra")
 * or off ("removida"), and until when. Editable only where the team router
 * says so — the switches stop at the reader's own permissions (the ceiling),
 * and a person always reads their own sheet, never edits it.
 */
export function PermissionsSheet({ memberId, orgType, onClose }: { memberId: string | null; orgType: OrgType; onClose: () => void }) {
    const t = useTranslations("App.settings.permissions")

    return (
        <Sheet open={memberId !== null} onOpenChange={(next) => { if (!next) onClose() }}>
            <SheetContent side="right" className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
                <SheetHeader className="sr-only">
                    <SheetTitle>{t("title")}</SheetTitle>
                    <SheetDescription>{t("description")}</SheetDescription>
                </SheetHeader>

                {memberId && <Panel key={memberId} memberId={memberId} orgType={orgType} />}
            </SheetContent>
        </Sheet>
    )
}

function Panel({ memberId, orgType }: { memberId: string; orgType: OrgType }) {
    const t = useTranslations("App.settings")
    const f = useFormatter()
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const { data, isPending, isError } = useQuery(trpc.team.permissions.get.queryOptions({ memberId }))

    const [temporary, setTemporary] = useState<Permission | null>(null)

    const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.team.pathKey() })
    const options = {
        onSuccess: async () => {
            setTemporary(null)
            await refresh()
            toast.success(t("permissions.saved"))
        },
        onError: () => toast.error(t("permissions.failed")),
    }

    const set = useMutation(trpc.team.permissions.set.mutationOptions(options))
    const lift = useMutation(trpc.team.actingOwner.grant.mutationOptions(options))
    const unlift = useMutation(trpc.team.actingOwner.revoke.mutationOptions(options))
    const busy = set.isPending || lift.isPending || unlift.isPending

    if (isPending) return <div className="flex justify-center py-12"><Spinner className="size-5" /></div>
    if (isError || !data) return <p className="text-destructive p-6 text-sm">{t("permissions.error")}</p>

    const day = (date: Date) => f.dateTime(date, { day: "numeric", month: "short" })
    const when = (date: Date) => f.dateTime(date, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="border-b px-5 pt-5 pb-4">
                <h2 className="font-heading text-lg font-semibold">{t("permissions.heading", { name: data.name?.trim() || data.email })}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="secondary">{t(`members.roles.${profileKey(data.profile, orgType)}`)}</Badge>
                    {data.actingOwner && data.actingWindow?.endsAt && (
                        <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
                            {t("members.acting", { date: day(data.actingWindow.endsAt) })}
                        </Badge>
                    )}
                </div>
                <p className="text-muted-foreground mt-2 text-xs">
                    {data.self ? t("permissions.self") : data.editable ? t("permissions.editable") : t("permissions.read-only")}
                </p>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
                {data.canLift && (
                    <ActingOwnerCard
                        current={data.actingWindow}
                        busy={busy}
                        when={when}
                        onGrant={(startsAt, endsAt) => lift.mutate({ memberId, startsAt, endsAt })}
                        onRevoke={(id) => unlift.mutate({ id })}
                    />
                )}

                {PERMISSION_GROUPS.map((group) => (
                    <section key={group.id} className="mb-5">
                        <h3 className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">{t(`permissions.groups.${group.id}` as "permissions.groups.money")}</h3>

                        <ul className="divide-y">
                            {group.permissions.map((permission) => {
                                const on = data.permissions.includes(permission)
                                const byDefault = data.defaults.includes(permission)
                                const changes = data.changes.filter((change) => change.permission === permission)
                                const live = changes.find((change) => change.live)
                                const upcoming = changes.find((change) => !change.live)
                                const mayTurnOn = data.grantable.includes(permission)
                                const hint = live?.kind === "grant" ? "extra" : live?.kind === "remove" ? "removed" : byDefault ? "default" : null

                                return (
                                    <li key={permission} className="py-2.5">
                                        <div className="flex items-center gap-3">
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm">{t(`permissions.labels.${permission}`)}</p>
                                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                                                    {hint && <span className="text-muted-foreground">{t(`permissions.hint.${hint}`)}</span>}
                                                    {live?.endsAt && <Badge variant="outline" className="text-[10px]">{t("permissions.until", { date: day(live.endsAt) })}</Badge>}
                                                    {upcoming && (
                                                        <Badge variant="outline" className="text-[10px]">
                                                            {t(upcoming.kind === "grant" ? "permissions.upcoming-on" : "permissions.upcoming-off", { date: when(upcoming.startsAt) })}
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>

                                            {data.editable && changes.length > 0 && (
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="size-7"
                                                    disabled={busy || (byDefault && !mayTurnOn)}
                                                    aria-label={t("permissions.reset")}
                                                    title={t("permissions.reset")}
                                                    onClick={() => set.mutate({ memberId, permission, on: byDefault })}
                                                >
                                                    <IconRestore className="size-4" />
                                                </Button>
                                            )}

                                            {data.editable && (
                                                <Button
                                                    size="icon"
                                                    variant={temporary === permission ? "secondary" : "ghost"}
                                                    className="size-7"
                                                    disabled={busy || (!on && !mayTurnOn)}
                                                    aria-label={t("permissions.temporary")}
                                                    title={t("permissions.temporary")}
                                                    onClick={() => setTemporary(temporary === permission ? null : permission)}
                                                >
                                                    <IconClock className="size-4" />
                                                </Button>
                                            )}

                                            <Switch
                                                checked={on}
                                                disabled={!data.editable || busy || (!on && !mayTurnOn)}
                                                aria-label={t(`permissions.labels.${permission}`)}
                                                onCheckedChange={(next) => set.mutate({ memberId, permission, on: next })}
                                            />
                                        </div>

                                        {temporary === permission && (
                                            <WindowForm
                                                submitLabel={t(on ? "permissions.off-for-window" : "permissions.on-for-window")}
                                                busy={busy}
                                                onSubmit={(startsAt, endsAt) => set.mutate({ memberId, permission, on: !on, startsAt, endsAt })}
                                            />
                                        )}
                                    </li>
                                )
                            })}
                        </ul>
                    </section>
                ))}
            </div>
        </div>
    )
}

/**
 * The real CEO's lift of somebody to acting CEO for a window that has to
 * end: every permission, and the team below CEO to manage, until then.
 */
function ActingOwnerCard({
    current,
    busy,
    when,
    onGrant,
    onRevoke,
}: {
    current: { id: string; startsAt: Date; endsAt: Date | null; live: boolean; grantedByName: string | null } | null
    busy: boolean
    when: (date: Date) => string
    onGrant: (startsAt: Date, endsAt: Date) => void
    onRevoke: (id: string) => void
}) {
    const t = useTranslations("App.settings.permissions.acting")

    return (
        <section className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <h3 className="flex items-center gap-2 text-sm font-medium">
                <IconCrown className="size-4 text-amber-600 dark:text-amber-400" stroke={1.5} />
                {t("title")}
            </h3>
            <p className="text-muted-foreground mt-1 text-xs">{t("description")}</p>

            {current ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm">
                        {t(current.live ? "live" : "upcoming", { from: when(current.startsAt), until: current.endsAt ? when(current.endsAt) : "—" })}
                    </span>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => onRevoke(current.id)}>
                        {t("revoke")}
                    </Button>
                </div>
            ) : (
                <WindowForm submitLabel={t("grant")} busy={busy} onSubmit={onGrant} />
            )}
        </section>
    )
}

/** A from–until pair in Maputo time; the end is required and after the start. */
function WindowForm({ submitLabel, busy, onSubmit }: { submitLabel: string; busy: boolean; onSubmit: (startsAt: Date, endsAt: Date) => void }) {
    const t = useTranslations("App.settings.permissions.window")
    const now = useNow({ updateInterval: 60_000 })

    const [from, setFrom] = useState(() => toMaputoInput(new Date()))
    const [until, setUntil] = useState(() => toMaputoInput(new Date(Date.now() + DAY_MS)))

    const startsAt = from ? fromMaputoInput(from) : null
    const endsAt = until ? fromMaputoInput(until) : null
    const valid = startsAt !== null && endsAt !== null && endsAt > startsAt && endsAt > now

    return (
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="grid gap-1">
                <Label className="text-xs">{t("from")}</Label>
                <Input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} />
            </div>
            <div className="grid gap-1">
                <Label className="text-xs">{t("until")}</Label>
                <Input type="datetime-local" value={until} onChange={(event) => setUntil(event.target.value)} />
            </div>
            <Button size="sm" disabled={busy || !valid} onClick={() => { if (valid && startsAt && endsAt) onSubmit(startsAt, endsAt) }}>
                {submitLabel}
            </Button>
            <p className="text-muted-foreground text-xs sm:col-span-3">{valid ? t("zone") : t("invalid")}</p>
        </div>
    )
}
