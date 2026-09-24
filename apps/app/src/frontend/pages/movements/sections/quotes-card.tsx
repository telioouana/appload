"use client"

import { useState } from "react"
import { IconCheck, IconSend, IconX } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import { SectionCard } from "@workspace/ui/customs/detail/section-card"
import { initials } from "@workspace/ui/customs/list/table-cells"
import { cn } from "@workspace/ui/lib/utils"

import type { TrackingAllowance } from "@workspace/domain/subscription"

import { PlanDialog, planBlock, planRefusal, type PlanReason } from "@/components/plan-dialog"
import { useMoney } from "@/frontend/pages/movements/components/badges"
import { useMovementMutations } from "@/frontend/pages/movements/hooks/use-movement-mutations"
import { movementErrorKey, type MovementErrorMessage } from "@/frontend/pages/movements/lib/errors"
import type { MovementDetail, MovementRequestStatus, MovementRequestView } from "@/frontend/pages/movements/types"
import { SendRequestsDialog } from "@/frontend/pages/orders/sections/send-requests-dialog"

/** A request the owner can still take back; a quote already given survives it. */
const LIVE: readonly MovementRequestStatus[] = ["requested", "quoted"]

const MESSAGE_MAX = 500

/**
 * The quote round. The owner sees every transporter it asked, what each one
 * answered and can pick a price, or ask more of them while the load is still
 * out; a transporter sees only its own request, with whatever the owner
 * wrote to it, and the price it gave back.
 */
export function QuotesCard({
    load,
    allowance,
    organizationName,
}: {
    load: MovementDetail
    allowance: TrackingAllowance
    organizationName: string
}) {
    const t = useTranslations("App.loads.quotes")
    const tl = useTranslations("App.loads")
    const tv = useTranslations("App.orders")
    const f = useFormatter()
    const money = useMoney()

    const { sendRequests, withdrawRequest } = useMovementMutations()

    const [sendOpen, setSendOpen] = useState(false)
    const [awarding, setAwarding] = useState<MovementRequestView | null>(null)
    const [planReason, setPlanReason] = useState<PlanReason | null>(null)

    const owner = load.role === "owner"
    const { canSendRequests, canAward } = load.permissions
    // Awarding places the load, which a plan pays for: ask before the dialog
    const blocked = planBlock(allowance)

    return (
        <>
            <SectionCard
                title={t("title")}
                count={owner ? load.requests.length : undefined}
                actions={canSendRequests ? (
                    <Button size="sm" variant="outline" onClick={() => setSendOpen(true)}>
                        <IconSend />
                        {t("actions.ask")}
                    </Button>
                ) : undefined}
            >
                {load.requests.length === 0 ? (
                    <p className="text-muted-foreground py-2 text-sm">{t("empty")}</p>
                ) : (
                    <ul className="flex flex-col divide-y">
                        {load.requests.map((request) => (
                            <li key={request.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                                {owner && (
                                    <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                                        {initials(request.carrierName)}
                                    </span>
                                )}

                                <div className="flex min-w-0 flex-1 flex-col gap-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        {owner
                                            ? <span className="truncate text-sm font-medium">{request.carrierName}</span>
                                            : <span className="text-muted-foreground text-sm">{t("your-request")}</span>}
                                        <RequestChip status={request.status} />
                                    </div>

                                    {request.quote && (
                                        <p className="text-sm font-medium tabular-nums">
                                            {money(request.quote.total, request.quote.currency)}
                                            {request.quote.fiscalRegime && (
                                                <span className="text-muted-foreground ml-1.5 text-xs font-normal">{tv(`fiscalRegime.${request.quote.fiscalRegime}`)}</span>
                                            )}
                                        </p>
                                    )}

                                    {/* What the owner wrote goes to the transporter; what the
                                        transporter wrote back comes to the owner */}
                                    {!owner && request.message && (
                                        <p className="text-muted-foreground text-xs whitespace-pre-line">{request.message}</p>
                                    )}
                                    {request.note && (
                                        <p className="text-muted-foreground text-xs whitespace-pre-line">{request.note}</p>
                                    )}

                                    <p className="text-muted-foreground/70 text-xs">
                                        {request.respondedAt
                                            ? t("answered-on", { date: f.dateTime(request.respondedAt, { dateStyle: "medium" }) })
                                            : t("sent-on", { date: f.dateTime(request.createdAt, { dateStyle: "medium" }) })}
                                    </p>
                                </div>

                                {owner && LIVE.includes(request.status) && (
                                    <div className="flex shrink-0 items-center gap-1">
                                        {canAward && request.status === "quoted" && (
                                            <Button
                                                size="sm"
                                                onClick={() => blocked ? setPlanReason(blocked) : setAwarding(request)}
                                            >
                                                <IconCheck />
                                                {t("actions.award")}
                                            </Button>
                                        )}
                                        {canSendRequests && (
                                            <Button
                                                size="icon-sm"
                                                variant="ghost"
                                                aria-label={t("actions.withdraw")}
                                                disabled={withdrawRequest.isPending}
                                                onClick={() => withdrawRequest.mutate({ id: load.id, carrierOrgId: request.carrierId })}
                                            >
                                                <IconX />
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </SectionCard>

            {canSendRequests && (
                <SendRequestsDialog
                    alreadyRequested={load.requests.filter((request) => LIVE.includes(request.status)).map((request) => request.carrierId)}
                    open={sendOpen}
                    onOpenChange={(next) => { if (!next) sendRequests.reset(); setSendOpen(next) }}
                    allowAll
                    pending={sendRequests.isPending}
                    error={sendRequests.error ? tl(`errors.${movementErrorKey(sendRequests.error)}`) : null}
                    onSend={(carrierOrgIds, message) =>
                        sendRequests.mutateAsync({ id: load.id, expectedVersion: load.version, carrierOrgIds, message })}
                />
            )}

            {awarding && (
                <AwardDialog
                    load={load}
                    request={awarding}
                    onClose={() => setAwarding(null)}
                    onPlanRefused={setPlanReason}
                />
            )}

            {planReason && (
                <PlanDialog
                    reason={planReason}
                    allowance={allowance}
                    organizationName={organizationName}
                    onClose={() => setPlanReason(null)}
                />
            )}
        </>
    )
}

function RequestChip({ status }: { status: MovementRequestStatus }) {
    const t = useTranslations("App.loads.quotes.status")

    return (
        <Badge
            variant="outline"
            className={cn(
                "rounded-full font-normal",
                status === "quoted" || status === "awarded" ? "border-primary/40 text-primary"
                    : status === "requested" ? undefined
                        : "text-muted-foreground",
            )}
        >
            {t(status)}
        </Badge>
    )
}

/**
 * Picking a quote. The transporter and its price go on the load, the others
 * are told, and the load is offered to the winner at that price — its yes
 * is one click, and what that writes is what an accepted offer always wrote.
 */
function AwardDialog({
    load,
    request,
    onClose,
    onPlanRefused,
}: {
    load: MovementDetail
    request: MovementRequestView
    onClose: () => void
    onPlanRefused: (reason: PlanReason) => void
}) {
    const t = useTranslations("App.loads")
    const money = useMoney()

    const { award } = useMovementMutations()

    const [message, setMessage] = useState("")
    const [error, setError] = useState<MovementErrorMessage | null>(null)

    function submit() {
        setError(null)

        award.mutate(
            { id: load.id, expectedVersion: load.version, carrierOrgId: request.carrierId, message: message.trim() || undefined },
            {
                onSuccess: onClose,
                onError: (failure) => {
                    const reason = planRefusal(failure)

                    if (reason) {
                        onClose()
                        onPlanRefused(reason)
                        return
                    }

                    setError(movementErrorKey(failure))
                },
            },
        )
    }

    return (
        <Dialog open onOpenChange={(next) => { if (!next && !award.isPending) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("quotes.award.title")}</DialogTitle>
                    <DialogDescription>{t("quotes.award.description", { partner: request.carrierName })}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    {request.quote && (
                        <div className="bg-muted/40 flex items-center justify-between gap-4 rounded-xl px-4 py-3 text-sm">
                            <span className="text-muted-foreground">{t("offer.price")}</span>
                            <span className="font-medium tabular-nums">{money(request.quote.total, request.quote.currency)}</span>
                        </div>
                    )}

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="award-message">{t("offer.message")}</Label>
                        <Textarea
                            id="award-message"
                            value={message}
                            maxLength={MESSAGE_MAX}
                            disabled={award.isPending}
                            placeholder={t("offer.message-placeholder")}
                            onChange={(event) => setMessage(event.target.value)}
                        />
                    </div>

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" disabled={award.isPending} onClick={onClose}>
                        {t("dialogs.back")}
                    </Button>
                    <Button disabled={award.isPending} onClick={submit}>
                        {award.isPending && <Spinner className="size-4" />}
                        {t("quotes.award.submit")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
