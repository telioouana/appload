"use client"

import { useRef, useState } from "react"
import {
    IconAlertTriangle,
    IconArrowBackUp,
    IconBan,
    IconCalendarCheck,
    IconCheck,
    IconDots,
    IconFlagCheck,
    IconLock,
    IconMail,
    IconMapPinShare,
    IconPencil,
    IconSend,
    IconTransfer,
    IconTruckDelivery,
    IconCalendarClock,
    IconX,
    type Icon,
} from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

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

import { PlanDialog, planBlock, type PlanReason } from "@/components/plan-dialog"
import { useFlagLabel } from "@/frontend/pages/movements/components/badges"
import { useMovementMutations } from "@/frontend/pages/movements/hooks/use-movement-mutations"
import { ConvertDialog } from "@/frontend/pages/movements/sections/convert-dialog"
import { LoadSheet } from "@/frontend/pages/movements/sections/load-sheet"
import { OfferDialog } from "@/frontend/pages/movements/sections/offer-dialog"
import { RespondDialog } from "@/frontend/pages/movements/sections/respond-dialog"
import { SendConfirmationDialog } from "@/frontend/pages/movements/sections/send-confirmation-dialog"
import { TransitionDialog } from "@/frontend/pages/movements/sections/transition-dialog"
import type { MovementDetail, MovementStatus, OrgType, TransitionOption } from "@/frontend/pages/movements/types"

const MOVE_ICONS: Partial<Record<MovementStatus, Icon>> = {
    "procurement": IconArrowBackUp,
    "scheduled": IconCalendarClock,
    "booked": IconCalendarCheck,
    "in-transit": IconTruckDelivery,
    "delivered": IconFlagCheck,
    "closed": IconLock,
}

type Open =
    | { kind: "transition"; option: TransitionOption }
    | { kind: "offer" }
    | { kind: "respond"; decision: "accept" | "decline" }
    | { kind: "convert" }
    | { kind: "confirmation" }
    | { kind: "edit" }
    | null

/**
 * Everything the reader can do to a load, from what the server said it may
 * do (`permissions`) — never from a rule restated here. The moves forward
 * are buttons; the rest, and calling the load off, sit behind the menu.
 *
 * Putting a truck on the road, offering a load and accepting one are what a
 * plan pays for, so those consult the allowance before opening anything and
 * answer a server refusal with the same dialog.
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
    const { permissions } = load

    const { withdraw, requestLocation } = useMovementMutations()

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

    const forward = permissions.transitions.filter((option) => option.to !== "cancelled")
    const cancel = permissions.transitions.find((option) => option.to === "cancelled")
    const canEdit = permissions.editable.length > 0
    // The confirmation is what the partner works from, so it is worth sending
    // from the moment the load is placed with it until the truck arrives
    const canConfirm = permissions.canManageDocuments
        && load.execution === "partner"
        && (load.status === "scheduled" || load.status === "booked" || load.status === "in-transit")

    const menu = canEdit || canConfirm || permissions.canRequestLocation || permissions.canConvert
        || permissions.canWithdraw || cancel

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

                {permissions.canOffer && (
                    <Button size="sm" onClick={() => gated({ kind: "offer" })}>
                        <IconSend className="size-4" stroke={1.5} />
                        {t("actions.offer")}
                    </Button>
                )}

                {forward.map((option) => {
                    const MoveIcon = MOVE_ICONS[option.to] ?? IconTruckDelivery
                    const onClick = () => option.to === "in-transit"
                        ? gated({ kind: "transition", option })
                        : setOpen({ kind: "transition", option })

                    const button = (
                        <Button
                            size="sm"
                            variant={option.to === "procurement" ? "outline" : "default"}
                            disabled={option.blocker !== null}
                            onClick={onClick}
                        >
                            <MoveIcon className="size-4" stroke={1.5} />
                            {t(`actions.to.${option.to}`)}
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

                            {cancel && (
                                <>
                                    <DropdownMenuSeparator />
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

            {open?.kind === "convert" && <ConvertDialog load={load} onClose={close} />}

            {open?.kind === "confirmation" && (
                <SendConfirmationDialog load={load} companyName={organizationName} onClose={close} />
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
