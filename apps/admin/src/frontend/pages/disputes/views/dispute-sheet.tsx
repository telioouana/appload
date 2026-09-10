"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconArrowRight, IconCheck, IconExternalLink, IconGavel, IconLayoutSidebarRightExpand, IconPencil, IconX } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"
import { Link } from "@/i18n/navigation"
import { authClient } from "@workspace/auth/client"
import { isAuthorized, type StaffRole } from "@workspace/auth/user-permissions"
import { CURRENCY, DISPUTE_LIABLE_PARTY, isActiveDispute, type DisputeLiableParty } from "@workspace/db/types"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Switch } from "@workspace/ui/components/switch"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Textarea } from "@workspace/ui/components/textarea"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"

import { useTRPC } from "@/backend/api/client"
import { domainErrorCode } from "@/lib/trpc-error"
import { Mono } from "@workspace/ui/customs/list/table-cells"
import { OrderStatusBadge, place } from "@/frontend/pages/orders/sections/order-item-shared"
import { useDisputeSheet } from "@/frontend/pages/disputes/hooks/use-dispute-sheet"
import { DisputeReasonBadge, DisputeStatusBadge } from "@/frontend/pages/disputes/sections/dispute-badges"
import { ResolveDisputeDialog } from "@/frontend/pages/disputes/components/resolve-dispute-dialog"

type Currency = (typeof CURRENCY)[number]

const ERROR_CODES = ["VERSION_CONFLICT", "DISPUTE_CLOSED", "NOT_ALLOWED", "NOT_FOUND", "UNKNOWN"] as const
const NONE = "__none"

/**
 * The dispute panel the list mounts once, keyed by `?id=`. Holds toggle in
 * place, details edit in place, and the supervisory moves (under review,
 * settle, close) sit in the header. The order it belongs to is one click
 * away in either direction.
 */
export function DisputeSheet() {
    const t = useTranslations("Admin.disputes.sheet")
    const { id, close } = useDisputeSheet()

    return (
        <Sheet open={Boolean(id)} onOpenChange={(next) => { if (!next) close() }}>
            <SheetContent
                side="right"
                showCloseButton={false}
                className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none md:data-[side=right]:w-3/5 2xl:data-[side=right]:w-[920px]"
            >
                <SheetHeader className="sr-only">
                    <SheetTitle>{t("title")}</SheetTitle>
                    <SheetDescription>{t("description")}</SheetDescription>
                </SheetHeader>

                {id && <DisputePanel key={id} id={id} onClose={close} />}
            </SheetContent>
        </Sheet>
    )
}

function DisputePanel({ id, onClose }: { id: string; onClose: () => void }) {
    const t = useTranslations("Admin.disputes")
    const f = useFormatter()
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const { data, isPending, isError } = useQuery(trpc.disputes.get.queryOptions({ id }))
    const { mutateAsync: update, isPending: saving } = useMutation(trpc.disputes.update.mutationOptions())

    const { data: session } = authClient.useSession()
    const role: StaffRole =
        session?.user.role === "admin" ? "admin" :
            session?.user.role === "manager" ? "manager" : "user"

    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState<{ description: string; liable: DisputeLiableParty | typeof NONE; claimed: string; currency: Currency }>({ description: "", liable: NONE, claimed: "", currency: "MZN" })
    const [resolveOpen, setResolveOpen] = useState(false)
    const [error, setError] = useState<(typeof ERROR_CODES)[number] | null>(null)

    if (isPending) return <PanelSkeleton />
    if (isError || !data) return <PanelError onClose={onClose} />

    const { dispute, order, history, openedByName } = data
    const active = isActiveDispute(dispute.status)
    const canUpdate = active && isAuthorized(role, "dispute", ["update"])
    const canResolve = active && isAuthorized(role, "dispute", ["resolve"])

    const invalidate = () => {
        queryClient.invalidateQueries(trpc.disputes.pathFilter())
        queryClient.invalidateQueries(trpc.orders.pathFilter())
        queryClient.invalidateQueries(trpc.order.get.queryFilter({ orderId: order.orderId }))
        queryClient.invalidateQueries(trpc.order.transitionOptions.queryFilter({ orderId: order.orderId }))
    }

    const patch = async (fields: Parameters<typeof update>[0]["patch"]) => {
        setError(null)
        try {
            await update({ id, expectedVersion: dispute.version, patch: fields })
            invalidate()
            return true
        } catch (err) {
            setError(domainErrorCode(err, ERROR_CODES, "UNKNOWN"))
            return false
        }
    }

    const startEditing = () => {
        setDraft({
            description: dispute.description,
            liable: dispute.liableParty ?? NONE,
            claimed: dispute.claimedAmount ?? "",
            currency: dispute.claimedCurrency ?? order.shipperCurrency ?? "MZN",
        })
        setEditing(true)
    }

    const saveDetails = async () => {
        const amount = draft.claimed.trim() === "" ? null : Number(draft.claimed)
        if (amount !== null && !(Number.isFinite(amount) && amount >= 0)) return
        if (draft.description.trim().length < 10) return

        const ok = await patch({
            description: draft.description.trim(),
            liableParty: draft.liable === NONE ? null : draft.liable,
            claimedAmount: amount,
            claimedCurrency: amount === null ? null : draft.currency,
        })
        if (ok) {
            setEditing(false)
            toast(t("sheet.saved"))
        }
    }

    const money = (amount: string | null, currency: string | null) =>
        amount === null ? "—" : `${f.number(Number(amount), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency ?? ""}`

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-col gap-4 px-5 pt-5 pb-4 md:px-6">
                <div className="flex items-start gap-3.5">
                    <span className="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-2xl">
                        <IconGavel className="size-6" stroke={1.5} />
                    </span>

                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="font-heading truncate text-lg font-semibold tracking-tight">{order.orderId}</h2>
                            <DisputeStatusBadge status={dispute.status} />
                            <DisputeReasonBadge reason={dispute.reason} />
                        </div>
                        <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-[13px]">
                            <span className="truncate">{order.shipperName}</span>
                            {order.carrierName && <><span>·</span><span className="truncate">{order.carrierName}</span></>}
                            <span>·</span>
                            <span>{t("sheet.opened-by", { date: f.dateTime(dispute.openedAt, { day: "numeric", month: "short", year: "numeric" }), name: openedByName ?? t("values.system") })}</span>
                        </div>
                    </div>

                    <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("sheet.close")} className="bg-secondary shrink-0">
                        <IconX className="size-4" stroke={1.5} />
                    </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {canUpdate && dispute.status === "open" && (
                        <Button size="sm" variant="outline" disabled={saving} onClick={() => patch({ status: "under-review" }).then((ok) => ok && toast(t("sheet.moved-review")))}>
                            <IconArrowRight />
                            {t("sheet.mark-review")}
                        </Button>
                    )}
                    {canResolve && (
                        <Button size="sm" onClick={() => setResolveOpen(true)}>
                            <IconCheck />
                            {t("sheet.resolve")}
                        </Button>
                    )}
                    <Button asChild size="sm" variant="outline">
                        <Link href={{ pathname: "/orders/all", query: { id: order.orderId } }}>
                            <IconLayoutSidebarRightExpand />
                            {t("sheet.open-order")}
                        </Link>
                    </Button>
                    <Button asChild size="sm" variant="ghost">
                        <Link href={{ pathname: "/orders/details/[orderId]", params: { orderId: order.orderId } }}>
                            <IconExternalLink />
                            {t("sheet.full-order")}
                        </Link>
                    </Button>
                </div>

                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                    </Alert>
                )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto border-t px-5 py-5 md:px-6">
                <Block title={t("sheet.holds")} hint={active ? t("sheet.holds-hint") : t("sheet.holds-lifted")}>
                    <div className="flex flex-col gap-3">
                        <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                            <span>{t("values.hold-shipper")}</span>
                            <Switch checked={dispute.holdShipperPayments} disabled={!canUpdate || saving} onCheckedChange={(checked) => patch({ holdShipperPayments: checked })} />
                        </label>
                        <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                            <span>{t("values.hold-carrier")}</span>
                            <Switch checked={dispute.holdCarrierPayments} disabled={!canUpdate || saving} onCheckedChange={(checked) => patch({ holdCarrierPayments: checked })} />
                        </label>
                    </div>
                </Block>

                <Block
                    title={t("sheet.details")}
                    action={canUpdate && !editing ? (
                        <Button size="sm" variant="ghost" onClick={startEditing}>
                            <IconPencil />
                            {t("sheet.edit")}
                        </Button>
                    ) : undefined}
                >
                    {editing ? (
                        <div className="flex flex-col gap-3">
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="dispute-edit-description">{t("form.description")}</Label>
                                <Textarea id="dispute-edit-description" rows={4} maxLength={4000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} disabled={saving} />
                            </div>
                            <div className="grid gap-3 sm:grid-cols-3">
                                <div className="flex flex-col gap-2">
                                    <Label>{t("form.liable")}</Label>
                                    <Select value={draft.liable} onValueChange={(value) => setDraft({ ...draft, liable: value as DisputeLiableParty | typeof NONE })} disabled={saving}>
                                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                                        <SelectContent position="popper">
                                            <SelectItem value={NONE}>{t("form.liable-none")}</SelectItem>
                                            {DISPUTE_LIABLE_PARTY.map((value) => <SelectItem key={value} value={value}>{t(`values.liable.${value}`)}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="flex flex-col gap-2">
                                    <Label htmlFor="dispute-edit-claimed">{t("form.claimed")}</Label>
                                    <Input id="dispute-edit-claimed" type="number" inputMode="decimal" min={0} step="0.01" value={draft.claimed} onChange={(event) => setDraft({ ...draft, claimed: event.target.value })} disabled={saving} />
                                </div>
                                <div className="flex flex-col gap-2">
                                    <Label>{t("form.currency")}</Label>
                                    <Select value={draft.currency} onValueChange={(value) => setDraft({ ...draft, currency: value as Currency })} disabled={saving}>
                                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                                        <SelectContent position="popper">
                                            {CURRENCY.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>{t("form.cancel")}</Button>
                                <Button size="sm" onClick={saveDetails} disabled={saving || draft.description.trim().length < 10}>{t("form.save")}</Button>
                            </div>
                        </div>
                    ) : (
                        <dl className="grid gap-3 text-sm sm:grid-cols-2">
                            <div className="sm:col-span-2">
                                <dt className="text-muted-foreground text-xs">{t("form.description")}</dt>
                                <dd className="whitespace-pre-wrap">{dispute.description}</dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground text-xs">{t("form.liable")}</dt>
                                <dd>{dispute.liableParty ? t(`values.liable.${dispute.liableParty}`) : "—"}</dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground text-xs">{t("form.claimed")}</dt>
                                <dd className="tabular-nums">{money(dispute.claimedAmount, dispute.claimedCurrency)}</dd>
                            </div>
                        </dl>
                    )}
                </Block>

                {dispute.resolution && (
                    <Block title={t("sheet.resolution")}>
                        <p className="text-sm whitespace-pre-wrap">{dispute.resolution}</p>
                        {dispute.resolvedAt && (
                            <p className="text-muted-foreground mt-2 text-xs">
                                {f.dateTime(dispute.resolvedAt, { day: "numeric", month: "short", year: "numeric" })}
                            </p>
                        )}
                    </Block>
                )}

                <Block title={t("sheet.order")}>
                    <dl className="grid gap-3 text-sm sm:grid-cols-2">
                        <div>
                            <dt className="text-muted-foreground text-xs">{t("sheet.order-status")}</dt>
                            <dd><OrderStatusBadge status={order.status} className="mt-1 px-1.5 py-0.5 text-xs" /></dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground text-xs">{t("sheet.route")}</dt>
                            <dd>{place(order.loadingAddress)} → {place(order.offloadingAddress)}</dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground text-xs">{t("sheet.shipper-total")}</dt>
                            <dd className="tabular-nums">{money(order.shipperTotal, order.shipperCurrency)}</dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground text-xs">{t("sheet.carrier-total")}</dt>
                            <dd className="tabular-nums">{money(order.carrierTotal, order.carrierCurrency)}</dd>
                        </div>
                    </dl>
                </Block>

                <Block title={t("sheet.terms")} hint={t("sheet.terms-next")}>
                    <p className="text-muted-foreground text-sm">
                        {dispute.carrierDebtAmount
                            ? money(dispute.carrierDebtAmount, dispute.carrierDebtCurrency)
                            : t("sheet.terms-none")}
                    </p>
                </Block>

                <Block title={t("sheet.history")}>
                    {history.length === 0 ? (
                        <p className="text-muted-foreground text-sm">{t("sheet.no-history")}</p>
                    ) : (
                        <ol className="flex flex-col gap-2 text-sm">
                            {history.map((entry) => {
                                const action = typeof entry.metadata.action === "string" ? entry.metadata.action : null
                                const status = typeof entry.metadata.status === "string" ? entry.metadata.status : null
                                return (
                                    <li key={entry.id} className="flex flex-col gap-0.5">
                                        <span className="flex flex-wrap items-center gap-1.5">
                                            <span className="font-medium">{action ? t(`values.actions.${action}` as never) : t("sheet.history")}</span>
                                            {status && <DisputeStatusBadge status={status as never} />}
                                        </span>
                                        {typeof entry.metadata.resolution === "string" && <span className="text-muted-foreground">{entry.metadata.resolution}</span>}
                                        <span className="text-muted-foreground/70 text-xs">
                                            {f.dateTime(entry.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                                            {entry.actorName ? ` · ${entry.actorName}` : ""}
                                        </span>
                                    </li>
                                )
                            })}
                        </ol>
                    )}
                </Block>
            </div>

            <div className="text-muted-foreground flex items-center justify-between gap-3 border-t px-5 py-2.5 text-xs md:px-6">
                <span className="flex items-center gap-1.5">
                    <Mono>{dispute.id.slice(0, 8)}</Mono>
                </span>
                <span className="tabular-nums">{t("sheet.updated", { date: f.dateTime(dispute.updatedAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}</span>
            </div>

            {resolveOpen && (
                <ResolveDisputeDialog id={dispute.id} orderId={order.orderId} expectedVersion={dispute.version} open={resolveOpen} onClose={() => setResolveOpen(false)} />
            )}
        </div>
    )
}

function Block({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="rounded-2xl border p-4">
            <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex flex-col">
                    <h3 className="text-muted-foreground text-xs font-medium">{title}</h3>
                    {hint && <p className="text-muted-foreground/80 text-xs">{hint}</p>}
                </div>
                {action}
            </div>
            {children}
        </section>
    )
}

function PanelSkeleton() {
    return (
        <div className="flex flex-col gap-4 p-6">
            <div className="flex items-center gap-3">
                <Skeleton className="size-12 rounded-2xl" />
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-5 w-40 rounded-md" />
                    <Skeleton className="h-3.5 w-64 rounded-md" />
                </div>
            </div>
            <Skeleton className="h-8 w-72 rounded-md" />
            {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-2xl" />)}
        </div>
    )
}

function PanelError({ onClose }: { onClose: () => void }) {
    const t = useTranslations("Admin.disputes.sheet")

    return (
        <div className="flex flex-col gap-4 p-6">
            <Alert variant="destructive"><AlertDescription>{t("load-failed")}</AlertDescription></Alert>
            <Button variant="outline" onClick={onClose} className="self-start">{t("close")}</Button>
        </div>
    )
}
