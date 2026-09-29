"use client"

import { useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
    IconAlertOctagon,
    IconAlertTriangle,
    IconArrowBackUp,
    IconBan,
    IconCalendarCheck,
    IconCheck,
    IconChevronDown,
    IconDots,
    IconFileTime,
    IconFlagCheck,
    IconForklift,
    IconGavel,
    IconInvoice,
    IconLock,
    IconMail,
    IconMapPinShare,
    IconMessageCircle,
    IconMessages,
    IconNavigationPause,
    IconPencil,
    IconRoute,
    IconSend,
    IconTransfer,
    IconTruckDelivery,
    IconTruckLoading,
    IconCalendarClock,
    IconUrgent,
    IconX,
    type Icon,
} from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { Link } from "@/i18n/navigation"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import type { TrackingAllowance } from "@workspace/domain/subscription"

import { useTRPC } from "@/backend/api/client"
import { PlanDialog, planBlock, type PlanReason } from "@/components/plan-dialog"
import { CancelOrderDialog } from "@/frontend/pages/orders/sections/cancel-order-dialog"
import { useFlagLabel, useMoveLabel } from "@/frontend/pages/movements/components/badges"
import { useMovementMutations } from "@/frontend/pages/movements/hooks/use-movement-mutations"
import { ConvertDialog } from "@/frontend/pages/movements/sections/convert-dialog"
import { LoadSheet } from "@/frontend/pages/movements/sections/load-sheet"
import { OfferDialog } from "@/frontend/pages/movements/sections/offer-dialog"
import { OpenDisputeDialog } from "@/frontend/pages/movements/sections/open-dispute-dialog"
import { QuoteDialog } from "@/frontend/pages/movements/sections/quote-dialog"
import { RespondDialog } from "@/frontend/pages/movements/sections/respond-dialog"
import { SendConfirmationDialog } from "@/frontend/pages/movements/sections/send-confirmation-dialog"
import { TransitionDialog } from "@/frontend/pages/movements/sections/transition-dialog"
import { isInProgress, type MovementDetail, type MovementStatus, type OrgType, type TransitionOption } from "@/frontend/pages/movements/types"

const MOVE_ICONS: Partial<Record<MovementStatus, Icon>> = {
    "procurement": IconArrowBackUp,
    "prospect": IconInvoice,
    "scheduled": IconCalendarClock,
    "booked": IconCalendarCheck,
    "at-loading": IconTruckLoading,
    "loading": IconForklift,
    "waiting-documents": IconFileTime,
    "on-route": IconRoute,
    "stopped": IconNavigationPause,
    "issue": IconAlertOctagon,
    "at-border": IconUrgent,
    "at-offloading": IconTruckLoading,
    "offloading": IconForklift,
    "delivered": IconFlagCheck,
    "closed": IconLock,
}

/** The moves that ask for a reason — a truck held up, a load called off — so they wait in the menu. */
const MENU_MOVES: readonly MovementStatus[] = ["stopped", "issue", "cancelled"]

type Open =
    | { kind: "transition"; option: TransitionOption }
    | { kind: "offer" }
    | { kind: "respond"; decision: "accept" | "decline" }
    | { kind: "quote"; decision: "quote" | "decline" }
    | { kind: "convert" }
    | { kind: "confirmation" }
    | { kind: "dispute" }
    | { kind: "edit" }
    | { kind: "cancel-appload" }
    | null

/**
 * Everything the reader can do to a load, from what the server said it may
 * do (`permissions`) — never from a rule restated here. The moves on are
 * buttons: the first one that is not a step back to the draft is filled in
 * (for a truck held up, that is resuming where it stopped), every other one
 * outlined. Saying a truck is stopped or in trouble, opening a dispute and
 * calling the load off each ask for a reason, and sit behind the menu with
 * the rest.
 *
 * Starting a load, offering one and accepting one are what a plan pays for,
 * so those consult the allowance before opening anything and answer a server
 * refusal with the same dialog.
 */
export function LoadActions({
    load,
    orgType,
    allowance,
    organizationName,
}: {
    load: MovementDetail
    orgType: OrgType
    allowance: TrackingAllowance
    organizationName: string
}) {
    const t = useTranslations("App.loads")
    const flagLabel = useFlagLabel()
    const moveLabel = useMoveLabel()
    const { permissions } = load
    const trpc = useTRPC()

    const { withdraw, requestLocation } = useMovementMutations()

    const appload = load.appload
    // The load the company handed to Appload is called off with Appload, on
    // the order itself — the panels below read the very same query, so this
    // costs nothing once the page is up
    const { data: order } = useQuery({
        ...trpc.orders.get.queryOptions({ orderId: appload?.orderId ?? "" }),
        enabled: appload?.role === "orderer",
    })
    const cancelWithAppload = appload?.role === "orderer" && Boolean(order?.permissions.canCancel)

    const [open, setOpen] = useState<Open>(null)
    // Set when a menu item opens a dialog or the sheet: the menu must not
    // hand focus back to its trigger as it closes, or the sheet it just
    // opened reads that as a click away and shuts again
    const fromMenu = useRef(false)
    const openFromMenu = (next: Open) => {
        fromMenu.current = true
        setOpen(next)
    }
    const [planReason, setPlanReason] = useState<PlanReason | null>(null)

    const close = () => setOpen(null)
    const blocked = planBlock(allowance)

    /** Opens a dialog, unless the plan would refuse it anyway. */
    const gated = (next: Open) => {
        if (blocked) {
            setPlanReason(blocked)
            return
        }
        setOpen(next)
    }

    const forward = permissions.transitions.filter((option) => !MENU_MOVES.includes(option.to))
    const interruptions = permissions.transitions.filter((option) => option.to === "stopped" || option.to === "issue")
    const cancel = permissions.transitions.find((option) => option.to === "cancelled")
    // The first move on that is not a step back is the one the load waits for
    const primary = forward.find((option) => option.to !== "procurement")
    const canEdit = permissions.editable.length > 0
    // The confirmation is what the partner works from, so it is worth sending
    // from the moment the load is placed with it until the truck arrives
    const canConfirm = permissions.canManageDocuments
        && load.execution === "partner"
        && (load.status === "scheduled" || load.status === "booked" || isInProgress(load.status))

    // The shipment's own conversation, as this company opens it on the Chats
    // page: a load that follows an Appload order is the order's thread, one
    // of the company's own is the load's — and a client reads its order on
    // its own row, which carries the same conversation
    const chatSubject = appload
        ? `order:${appload.orderId}`
        : load.role !== "client" ? `movement:${load.id}` : null

    const tools = canEdit || canConfirm || permissions.canRequestLocation || permissions.canConvert || permissions.canWithdraw
    const trouble = interruptions.length > 0 || permissions.canOpenDispute
    const menu = tools || trouble || cancel || cancelWithAppload

    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                {permissions.canRespond && (
                    <>
                        <Button size="sm" onClick={() => gated({ kind: "respond", decision: "accept" })}>
                            <IconCheck className="size-4" stroke={1.5} />
                            {t("actions.accept")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setOpen({ kind: "respond", decision: "decline" })}>
                            <IconX className="size-4" stroke={1.5} />
                            {t("actions.decline")}
                        </Button>
                    </>
                )}

                {/* Asked for a price: naming one commits nothing yet, so no plan gate */}
                {permissions.canQuote && (
                    <>
                        <Button size="sm" onClick={() => setOpen({ kind: "quote", decision: "quote" })}>
                            <IconInvoice className="size-4" stroke={1.5} />
                            {t("quotes.actions.quote")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setOpen({ kind: "quote", decision: "decline" })}>
                            <IconX className="size-4" stroke={1.5} />
                            {t("actions.decline")}
                        </Button>
                    </>
                )}

                {permissions.canOffer && (
                    <Button size="sm" onClick={() => gated({ kind: "offer" })}>
                        <IconSend className="size-4" stroke={1.5} />
                        {t("actions.offer")}
                    </Button>
                )}

                {forward.map((option) => {
                    const MoveIcon = MOVE_ICONS[option.to] ?? IconTruckDelivery
                    const onClick = () => option.startsTracking
                        ? gated({ kind: "transition", option })
                        : setOpen({ kind: "transition", option })

                    const button = (
                        <Button
                            size="sm"
                            variant={option === primary ? "default" : "outline"}
                            disabled={option.blocker !== null}
                            onClick={onClick}
                        >
                            <MoveIcon className="size-4" stroke={1.5} />
                            {moveLabel(load.status, option.to)}
                            {/* Still open, only not complete: the move is taken with
                                the flags on record, and the dialog says which */}
                            {option.flags.length > 0 && <IconAlertTriangle className="size-4" stroke={1.5} />}
                        </Button>
                    )

                    if (!option.blocker && option.flags.length === 0) return <span key={option.to}>{button}</span>

                    // A disabled button takes no pointer events, so what is in
                    // the way — or what is missing — hangs off a wrapper that does
                    return (
                        <Tooltip key={option.to}>
                            <TooltipTrigger asChild>
                                <span tabIndex={0}>{button}</span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-64">
                                {option.blocker ? t(`blockers.${option.blocker}`) : option.flags.map(flagLabel).join(" · ")}
                            </TooltipContent>
                        </Tooltip>
                    )
                })}

                {/* The conversations this load has, both of them on the Chats
                    page: the driver on WhatsApp, and the other company */}
                {(permissions.canReadThread || chatSubject) && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline">
                                <IconMessages className="size-4" stroke={1.5} />
                                {t("actions.open-chat")}
                                <IconChevronDown className="size-4" stroke={1.5} />
                            </Button>
                        </DropdownMenuTrigger>

                        <DropdownMenuContent align="end" className="min-w-52">
                            {permissions.canReadThread && (
                                <DropdownMenuItem asChild>
                                    <Link href={{ pathname: "/chats", query: { c: load.id } }}>
                                        <IconMessageCircle stroke={1.5} />
                                        {t("actions.chat-driver")}
                                    </Link>
                                </DropdownMenuItem>
                            )}

                            {chatSubject && (
                                <DropdownMenuItem asChild>
                                    <Link href={{ pathname: "/chats", query: { t: chatSubject } }}>
                                        <IconMessages stroke={1.5} />
                                        {t("actions.chat-order")}
                                    </Link>
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}

                {menu && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button size="icon-sm" variant="outline" aria-label={t("actions.more")}>
                                {requestLocation.isPending || withdraw.isPending
                                    ? <Spinner className="size-4" />
                                    : <IconDots className="size-4" stroke={1.5} />}
                            </Button>
                        </DropdownMenuTrigger>

                        <DropdownMenuContent
                            align="end"
                            className="min-w-52"
                            onCloseAutoFocus={(event) => {
                                if (!fromMenu.current) return
                                fromMenu.current = false
                                event.preventDefault()
                            }}
                        >
                            {canEdit && (
                                <DropdownMenuItem onSelect={() => openFromMenu({ kind: "edit" })}>
                                    <IconPencil stroke={1.5} />
                                    {t("actions.edit")}
                                </DropdownMenuItem>
                            )}

                            {canConfirm && (
                                <DropdownMenuItem onSelect={() => openFromMenu({ kind: "confirmation" })}>
                                    <IconMail stroke={1.5} />
                                    {t("actions.send-confirmation")}
                                </DropdownMenuItem>
                            )}

                            {permissions.canRequestLocation && (
                                <DropdownMenuItem onSelect={() => requestLocation.mutate({ id: load.id })}>
                                    <IconMapPinShare stroke={1.5} />
                                    {t("actions.request-location")}
                                </DropdownMenuItem>
                            )}

                            {permissions.canConvert && (
                                <DropdownMenuItem onSelect={() => openFromMenu({ kind: "convert" })}>
                                    <IconTransfer stroke={1.5} />
                                    {t(load.execution === "own-fleet" ? "actions.convert.to-partner" : "actions.convert.to-own-fleet")}
                                </DropdownMenuItem>
                            )}

                            {permissions.canWithdraw && (
                                <DropdownMenuItem
                                    onSelect={() => withdraw.mutate({ id: load.id, expectedVersion: load.version })}
                                >
                                    <IconArrowBackUp stroke={1.5} />
                                    {t("actions.withdraw")}
                                </DropdownMenuItem>
                            )}

                            {trouble && (
                                <>
                                    {tools && <DropdownMenuSeparator />}

                                    {/* Each asks for a reason, which the dialog collects */}
                                    {interruptions.map((option) => {
                                        const MoveIcon = MOVE_ICONS[option.to] ?? IconAlertTriangle

                                        return (
                                            <DropdownMenuItem
                                                key={option.to}
                                                disabled={option.blocker !== null}
                                                onSelect={() => openFromMenu({ kind: "transition", option })}
                                            >
                                                <MoveIcon stroke={1.5} />
                                                {t(`actions.to.${option.to}`)}
                                            </DropdownMenuItem>
                                        )
                                    })}

                                    {permissions.canOpenDispute && (
                                        <DropdownMenuItem onSelect={() => openFromMenu({ kind: "dispute" })}>
                                            <IconGavel stroke={1.5} />
                                            {t("actions.open-dispute")}
                                        </DropdownMenuItem>
                                    )}
                                </>
                            )}

                            {cancel && (
                                <>
                                    {(tools || trouble) && <DropdownMenuSeparator />}
                                    <DropdownMenuItem
                                        variant="destructive"
                                        disabled={cancel.blocker !== null}
                                        onSelect={() => openFromMenu({ kind: "transition", option: cancel })}
                                    >
                                        <IconBan stroke={1.5} />
                                        {t("actions.to.cancelled")}
                                    </DropdownMenuItem>
                                </>
                            )}

                            {/* The row follows the order: calling the load off
                                is calling the order off, with a reason */}
                            {cancelWithAppload && (
                                <>
                                    {(tools || trouble) && <DropdownMenuSeparator />}
                                    <DropdownMenuItem
                                        variant="destructive"
                                        onSelect={() => openFromMenu({ kind: "cancel-appload" })}
                                    >
                                        <IconBan stroke={1.5} />
                                        {t("appload.cancelWithAppload")}
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>

            {open?.kind === "transition" && (
                <TransitionDialog
                    load={load}
                    option={open.option}
                    onClose={close}
                    onPlanRefused={setPlanReason}
                />
            )}

            {open?.kind === "offer" && <OfferDialog load={load} onClose={close} onPlanRefused={setPlanReason} />}

            {open?.kind === "respond" && (
                <RespondDialog load={load} decision={open.decision} onClose={close} onPlanRefused={setPlanReason} />
            )}

            {open?.kind === "quote" && <QuoteDialog load={load} decision={open.decision} onClose={close} />}

            {open?.kind === "convert" && <ConvertDialog load={load} onClose={close} />}

            {open?.kind === "dispute" && <OpenDisputeDialog load={load} onClose={close} />}

            {open?.kind === "confirmation" && (
                <SendConfirmationDialog load={load} companyName={organizationName} onClose={close} />
            )}

            {open?.kind === "cancel-appload" && appload && order && (
                <CancelOrderDialog
                    orderId={appload.orderId}
                    expectedVersion={order.version}
                    open
                    onOpenChange={(next) => { if (!next) close() }}
                />
            )}

            <LoadSheet
                mode={{ kind: "edit", load }}
                orgType={orgType}
                allowance={allowance}
                organizationName={organizationName}
                open={open?.kind === "edit"}
                onOpenChange={(next) => { if (!next) close() }}
            />

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
