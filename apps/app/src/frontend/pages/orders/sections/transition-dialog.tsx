"use client"

import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { useForm } from "react-hook-form"
import { IconUpload, IconX } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Label } from "@workspace/ui/components/label"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { FieldGroup } from "@workspace/ui/components/field"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { useEdgeStore } from "@workspace/edgestore/client"
import { orderDocumentPath } from "@workspace/edgestore/path"

import { DriverInput } from "@/components/inputs/driver"
import { FleetInput } from "@/components/inputs/fleet"
import { orderErrorCode, orderErrorKey, type OrderErrorMessage } from "@/frontend/pages/orders/lib/errors"
import { useOrderMutations } from "@/frontend/pages/orders/hooks/use-order-mutations"
import { ACCEPTED_FILES } from "@/frontend/pages/orders/sections/add-document-dialog"
import type { OrderStatus, TransitionOption } from "@/frontend/pages/orders/types"
import {
    DispatchSchema,
    NOTE_MIN,
    NOTE_MAX,
    type DispatchMessageField,
    type PartnerDocumentType,
} from "@/backend/schemas/dispatch"

/** What the pickers bind (the visible text) next to the id each one chose. */
type RigForm = {
    driverId: string
    driverName: string
    truckId: string
    truckPlate: string
    trailerId: string
    trailerPlate: string
    linkId: string
    linkPlate: string
}

const EMPTY_RIG: RigForm = {
    driverId: "",
    driverName: "",
    truckId: "",
    truckPlate: "",
    trailerId: "",
    trailerPlate: "",
    linkId: "",
    linkPlate: "",
}

/** Which visible field an id's error belongs to; the ids themselves are not rendered. */
const FIELD_FOR: Record<string, keyof RigForm> = {
    driverId: "driverName",
    truckId: "truckPlate",
    trailerId: "trailerPlate",
    linkId: "linkPlate",
}

/**
 * The one door for a carrier's status changes. What a move demands comes
 * from `orders.transitionOptions` — the dialog never guesses what is legal,
 * and the server re-guards every move anyway — and this renders whichever of
 * the three payloads that move needs:
 *
 * - the rig, on the dispatch (booked → `to-loading`, and only there): the
 *   driver and the truck are picked from the carrier's own registry, and the
 *   mutation writes them onto the order before it moves it — a trip already
 *   running keeps the rig it left with;
 * - a note, on the interrupts and their corrections;
 * - a file, on delivery: the proof of delivery, uploaded before the move so
 *   no transition is ever recorded against an upload that failed.
 */
export function TransitionDialog({
    orderId,
    status,
    target,
    version,
    onClose,
}: {
    orderId: string
    /** Where the order stands now — the dispatch is only asked for on a booking */
    status: OrderStatus
    /** The move the caller picked, with what it demands */
    target: TransitionOption
    /** The order's version, the optimistic-lock handshake */
    version: number
    onClose: () => void
}) {
    const t = useTranslations("App.orders.transition")
    const tStatus = useTranslations("App.orders.status")
    const tError = useTranslations("App.orders")

    const { edgestore } = useEdgeStore()
    const { transition, refresh } = useOrderMutations()

    const [note, setNote] = useState("")
    const [file, setFile] = useState<File | null>(null)
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState<OrderErrorMessage | null>(null)
    const fileRef = useRef<HTMLInputElement>(null)

    const form = useForm<RigForm>({ defaultValues: EMPTY_RIG })

    const DispatchValues = useMemo(
        () => DispatchSchema((field: DispatchMessageField) => ({ error: t(`errors.${field}`) })),
        [t],
    )

    const to = target.to
    const needsRig = to === "to-loading" && status === "booked"
    const needsNote = target.requirements.includes("note")
    const documentType: PartnerDocumentType | null =
        target.requirements.includes("evidence") ? "evidence"
            : target.requirements.includes("pod") || to === "delivered" ? "pod"
                : null
    // Only a move that DEMANDS the file refuses to go without it; the proof
    // on a delivery is offered, because a carrier without it to hand should
    // still be able to say the load arrived
    const needsDocument = target.requirements.includes("pod") || target.requirements.includes("evidence")

    const isPending = uploading || transition.isPending
    const ready = (!needsNote || note.trim().length >= NOTE_MIN) && (!needsDocument || file !== null)

    async function confirm() {
        if (isPending) return

        setError(null)

        let dispatch: { driverId: string; truckId: string; trailerId?: string; linkId?: string } | undefined

        if (needsRig) {
            const values = form.getValues()
            const parsed = DispatchValues.safeParse({
                driverId: values.driverId,
                truckId: values.truckId,
                trailerId: values.trailerId || undefined,
                linkId: values.linkId || undefined,
            })

            if (!parsed.success) {
                // The ids are not on screen — the picker's text is — so each
                // complaint is shown against the field that produced it
                for (const issue of parsed.error.issues) {
                    const field = FIELD_FOR[String(issue.path[0])]
                    if (field) form.setError(field, { message: issue.message })
                }

                return
            }

            dispatch = parsed.data
        }

        let document: { type: PartnerDocumentType; url: string; title?: string; size?: number; mimeType?: string } | undefined

        if (file && documentType) {
            setUploading(true)

            try {
                const { url } = await edgestore.apploadFiles.upload({
                    file,
                    input: { path: orderDocumentPath(orderId, documentType) },
                })

                if (!url) {
                    setError("uploadFailed")
                    return
                }

                document = { type: documentType, url, title: file.name, size: file.size, mimeType: file.type }
            } catch (failure) {
                console.error(failure)
                setError("uploadFailed")
                return
            } finally {
                setUploading(false)
            }
        }

        transition.mutate(
            { orderId, to, expectedVersion: version, note: note.trim() || undefined, dispatch, document },
            {
                onSuccess: () => {
                    toast.success(t("toast", { status: tStatus(to) }))
                    onClose()
                },
                onError: (failure) => {
                    setError(orderErrorKey(failure))

                    // The page was built from a version that has since moved on
                    if (orderErrorCode(failure) === "VERSION_CONFLICT") void refresh()
                },
            },
        )
    }

    return (
        <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("title", { status: tStatus(to) })}</DialogTitle>
                    <DialogDescription>{t("description", { orderId })}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    {needsRig && (
                        <FieldGroup className="gap-4">
                            <DriverInput
                                control={form.control}
                                name="driverName"
                                isPending={isPending}
                                label={t("dispatch.driver.label")}
                                placeholder={t("dispatch.driver.placeholder")}
                                description={t("dispatch.driver.description")}
                                onSelect={(driver) => form.setValue("driverId", driver?.id ?? "")}
                            />

                            <FleetInput
                                kind="truck"
                                control={form.control}
                                name="truckPlate"
                                isPending={isPending}
                                label={t("dispatch.truck.label")}
                                placeholder={t("dispatch.truck.placeholder")}
                                onSelect={(truck) => form.setValue("truckId", truck?.id ?? "")}
                            />

                            <FleetInput
                                kind="trailer"
                                control={form.control}
                                name="trailerPlate"
                                isPending={isPending}
                                label={t("dispatch.trailer.label")}
                                placeholder={t("dispatch.trailer.placeholder")}
                                onSelect={(trailer) => form.setValue("trailerId", trailer?.id ?? "")}
                            />

                            <FleetInput
                                kind="link"
                                control={form.control}
                                name="linkPlate"
                                isPending={isPending}
                                label={t("dispatch.link.label")}
                                placeholder={t("dispatch.link.placeholder")}
                                onSelect={(link) => form.setValue("linkId", link?.id ?? "")}
                            />
                        </FieldGroup>
                    )}

                    {(needsNote || documentType !== null) && (
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="transition-note">
                                {needsNote ? t("note.label") : t("note.optional")}
                            </Label>
                            <Textarea
                                id="transition-note"
                                value={note}
                                rows={3}
                                maxLength={NOTE_MAX}
                                placeholder={t("note.placeholder")}
                                disabled={isPending}
                                onChange={(event) => setNote(event.target.value)}
                            />
                            {needsNote && <p className="text-muted-foreground text-xs">{t("note.hint", { min: NOTE_MIN })}</p>}
                        </div>
                    )}

                    {documentType !== null && (
                        <div className="flex flex-col gap-2">
                            <Label>{t(`document.${documentType}`)}</Label>

                            <div className="flex items-center gap-2">
                                <input
                                    ref={fileRef}
                                    type="file"
                                    className="hidden"
                                    accept={ACCEPTED_FILES.join(",")}
                                    onChange={(event) => {
                                        const picked = event.target.files?.[0] ?? null

                                        if (picked && !ACCEPTED_FILES.includes(picked.type)) {
                                            toast.error(t("document.format"))
                                            return
                                        }

                                        setFile(picked)
                                    }}
                                />

                                <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => fileRef.current?.click()}>
                                    <IconUpload />
                                    {file ? t("document.replace") : t("document.pick")}
                                </Button>

                                {file && (
                                    <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
                                        <span className="truncate">{file.name}</span>
                                        <button
                                            type="button"
                                            disabled={isPending}
                                            aria-label={t("document.remove")}
                                            onClick={() => setFile(null)}
                                        >
                                            <IconX className="size-3.5" />
                                        </button>
                                    </span>
                                )}
                            </div>

                            <p className="text-muted-foreground text-xs">
                                {needsDocument ? t("document.required") : t("document.optional")}
                            </p>
                        </div>
                    )}

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{tError(`errors.${error}`)}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" disabled={isPending} onClick={onClose}>
                        {t("cancel")}
                    </Button>
                    <Button disabled={!ready || isPending} onClick={() => void confirm()}>
                        {isPending && <Spinner className="size-4" />}
                        {t("confirm")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
