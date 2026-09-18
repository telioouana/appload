"use client"

import { useRef, useState } from "react"
import { toast } from "sonner"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconCamera, IconCheck, IconX } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { SectionCard } from "@workspace/ui/customs/detail/section-card"

import { useEdgeStore } from "@workspace/edgestore/client"
import { orderDocumentPath } from "@workspace/edgestore/path"
import { LOADING_CHECK_ITEMS, type LoadingCheckItemResult } from "@workspace/domain/orders/loading-check"
import { ON_GOING_STATUSES } from "@workspace/domain/orders/status-groups"

import { useTRPC } from "@/backend/api/client"
import { PaperPreview } from "@/frontend/pages/fleet/sections/paper-upload"
import { orderErrorKey, type OrderErrorMessage } from "@/frontend/pages/orders/lib/errors"
import type { OrderDetail, OrderStatus } from "@/frontend/pages/orders/types"

/** From the loading site onward; before that there is nothing to check. */
const CHECKED_STATUSES: OrderStatus[] = [...ON_GOING_STATUSES, "delivered", "completed"]

export const showsLoadingCheck = (status: OrderStatus) => CHECKED_STATUSES.includes(status)

const ACCEPTED_PHOTOS = ["image/jpeg", "image/png"]
const MAX_PHOTOS = 10

/**
 * The loading check on the order page: what the truck was dispatched with,
 * and the client's confirmation that the rig at the gate is the same one.
 *
 * The client that ordered the load fills the checklist in; everyone else —
 * the carrier above all, which is what is being checked — reads the result.
 * A mismatch flags the order, and from there only Appload can let the load
 * proceed.
 */
export function LoadingCheckCard({ order }: { order: OrderDetail }) {
    const t = useTranslations("App.orders.loadingCheck")
    const tError = useTranslations("App.orders")
    const tDoc = useTranslations("App.fleet.papers.doc-type")
    const f = useFormatter()

    const trpc = useTRPC()
    const queryClient = useQueryClient()
    const { edgestore } = useEdgeStore()

    const [answers, setAnswers] = useState<Record<string, boolean | null>>({})
    const [itemNotes, setItemNotes] = useState<Record<string, string>>({})
    const [note, setNote] = useState("")
    const [photos, setPhotos] = useState<File[]>([])
    const [openPapers, setOpenPapers] = useState<string | null>(null)
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState<OrderErrorMessage | null>(null)
    const photoRef = useRef<HTMLInputElement>(null)

    const { data, isPending } = useQuery(trpc.orders.loadingCheck.queryOptions({ orderId: order.orderId }))

    // The photos are ordinary order documents, filed through the same door
    // as any other upload; the check only references ids that already exist
    const addPhoto = useMutation(trpc.orders.documents.add.mutationOptions())

    const record = useMutation(trpc.orders.recordLoadingCheck.mutationOptions({
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: trpc.orders.pathKey() })
            toast.success(t("toast"))
        },
    }))

    // Nothing was dispatched and nothing was checked: the card has nothing
    // to say, which is the ordinary state of an order Admin moved by hand
    if (isPending || !data || (!data.pack && data.state.state === "none")) {
        return null
    }

    const { pack, state } = data
    // A conclusive check stands; one that was never run or left half done
    // can still be completed
    const form = data.canCheck && (state.state === "none" || state.state === "partial")
    const busy = uploading || record.isPending

    async function submit() {
        if (busy) return

        setError(null)

        const items: LoadingCheckItemResult[] = LOADING_CHECK_ITEMS.map((key) => ({
            key,
            ok: answers[key] ?? null,
            ...(itemNotes[key]?.trim() && { note: itemNotes[key]?.trim() }),
        }))

        const photoDocumentIds: string[] = []

        if (photos.length > 0) {
            setUploading(true)

            try {
                for (const file of photos) {
                    const { url } = await edgestore.apploadFiles.upload({
                        file,
                        input: { path: orderDocumentPath(order.orderId, "loading-photo") },
                    })

                    if (!url) {
                        setError("uploadFailed")
                        return
                    }

                    const document = await addPhoto.mutateAsync({
                        orderId: order.orderId,
                        type: "loading-photo",
                        url,
                        title: file.name,
                        size: file.size,
                        mimeType: file.type,
                    })

                    photoDocumentIds.push(document.id)
                }
            } catch (failure) {
                console.error(failure)
                setError(orderErrorKey(failure))
                return
            } finally {
                setUploading(false)
            }
        }

        record.mutate(
            { orderId: order.orderId, expectedVersion: order.version, items, note: note.trim() || undefined, photoDocumentIds },
            {
                onSuccess: () => {
                    setPhotos([])
                    setNote("")
                },
                onError: (failure) => setError(orderErrorKey(failure)),
            },
        )
    }

    return (
        <SectionCard title={t("title")}>
            <p className="text-muted-foreground text-xs">{t("description")}</p>

            {/* What left for the loading site, and the papers it left with */}
            {pack && (
                <div className="flex flex-col gap-3">
                    {pack.subjects.map((subject) => {
                        const id = `${subject.kind}-${subject.subjectId ?? subject.label}`
                        const open = openPapers === id

                        return (
                            <div key={id} className="flex flex-col gap-2 rounded-lg border p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex min-w-0 flex-col">
                                        <span className="truncate text-[13px] font-medium">{subject.label}</span>
                                        <span className="text-muted-foreground text-xs">{t(`kinds.${subject.kind}`)}</span>
                                    </div>

                                    {subject.documents.length > 0 ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => setOpenPapers(open ? null : id)}
                                        >
                                            {open ? t("papers.hide") : t("papers.show")}
                                        </Button>
                                    ) : (
                                        <Badge variant="secondary" className="shrink-0">{t("papers.none")}</Badge>
                                    )}
                                </div>

                                {/* The document NUMBER is not part of what the
                                    portal is told (the client checks the face
                                    against the licence above); the phone is */}
                                {subject.kind === "driver" && order.dispatch?.driverPhoneNumber && (
                                    <div className="text-muted-foreground flex flex-wrap gap-x-4 text-xs">
                                        <span>{t("papers.phone")}: {order.dispatch.driverPhoneNumber}</span>
                                    </div>
                                )}

                                {open && subject.documents.map((document) => (
                                    <div key={document.id} className="flex flex-col gap-1.5">
                                        <span className="text-muted-foreground text-xs">{tDoc(document.type)}</span>
                                        {document.pages.map((page, index) => (
                                            <PaperPreview key={page.url} page={page} index={index} />
                                        ))}
                                    </div>
                                ))}
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Dispatched, and the client has not looked yet */}
            {!state.check && !form && (
                <p className="text-muted-foreground text-xs">{t("outcome.none")}</p>
            )}

            {/* What was recorded, whoever recorded it */}
            {state.check && (
                <div className="flex flex-col gap-2 rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={state.state === "passed" ? "default" : state.state === "mismatch" ? "destructive" : "secondary"}>
                            {t(`outcome.${state.state}`)}
                        </Badge>
                        <span className="text-muted-foreground text-xs">
                            {t("recorded-by", {
                                name: data.checkedByName ?? t("recorded-appload"),
                                date: f.dateTime(state.check.checkedAt, { dateStyle: "medium", timeStyle: "short" }),
                            })}
                        </span>
                    </div>

                    <dl className="flex flex-col gap-1">
                        {state.check.items.map((item) => (
                            <div key={item.key} className="flex items-baseline justify-between gap-3 text-[13px]">
                                <dt className="text-muted-foreground">{t(`items.${item.key}`)}</dt>
                                <dd className="text-right">
                                    {item.ok === true ? t("answers.ok") : item.ok === false ? t("answers.no") : t("answers.untouched")}
                                    {item.note && <span className="text-muted-foreground"> · {item.note}</span>}
                                </dd>
                            </div>
                        ))}
                    </dl>

                    {state.check.note && <p className="text-muted-foreground text-xs">{state.check.note}</p>}

                    {data.photos.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {data.photos.map((photo) => (
                                <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer" className="bg-muted overflow-hidden rounded-md">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={photo.url} alt={photo.title ?? t("photos.label")} className="size-20 object-cover" />
                                </a>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {form && (
                <div className="flex flex-col gap-4 border-t pt-4">
                    {LOADING_CHECK_ITEMS.map((key) => (
                        <div key={key} className="flex flex-col gap-2">
                            <Label>{t(`items.${key}`)}</Label>

                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={answers[key] === true ? "default" : "outline"}
                                    disabled={busy}
                                    onClick={() => setAnswers((current) => ({ ...current, [key]: current[key] === true ? null : true }))}
                                >
                                    <IconCheck className="size-4" />
                                    {t("answers.ok")}
                                </Button>

                                <Button
                                    type="button"
                                    size="sm"
                                    variant={answers[key] === false ? "destructive" : "outline"}
                                    disabled={busy}
                                    onClick={() => setAnswers((current) => ({ ...current, [key]: current[key] === false ? null : false }))}
                                >
                                    <IconX className="size-4" />
                                    {t("answers.no")}
                                </Button>
                            </div>

                            <Input
                                value={itemNotes[key] ?? ""}
                                maxLength={500}
                                disabled={busy}
                                placeholder={t("item-note")}
                                onChange={(event) => setItemNotes((current) => ({ ...current, [key]: event.target.value }))}
                            />
                        </div>
                    ))}

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="loading-check-note">{t("note.label")}</Label>
                        <Textarea
                            id="loading-check-note"
                            value={note}
                            rows={2}
                            maxLength={2000}
                            disabled={busy}
                            placeholder={t("note.placeholder")}
                            onChange={(event) => setNote(event.target.value)}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label>{t("photos.label")}</Label>

                        <div className="flex flex-wrap items-center gap-2">
                            <input
                                ref={photoRef}
                                type="file"
                                multiple
                                hidden
                                accept={ACCEPTED_PHOTOS.join(",")}
                                capture="environment"
                                onChange={(event) => {
                                    const picked = [...(event.target.files ?? [])]
                                    event.target.value = ""

                                    if (picked.some((file) => !ACCEPTED_PHOTOS.includes(file.type))) {
                                        toast.error(t("photos.format"))
                                        return
                                    }

                                    setPhotos((current) => [...current, ...picked].slice(0, MAX_PHOTOS))
                                }}
                            />

                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busy || photos.length >= MAX_PHOTOS}
                                onClick={() => photoRef.current?.click()}
                            >
                                <IconCamera className="size-4" />
                                {t("photos.add")}
                            </Button>

                            {photos.map((file, index) => (
                                <span key={`${file.name}-${index}`} className="bg-muted inline-flex max-w-48 items-center gap-1 rounded-full px-2.5 py-1 text-xs">
                                    <span className="truncate">{file.name}</span>
                                    <button
                                        type="button"
                                        disabled={busy}
                                        aria-label={t("photos.remove")}
                                        onClick={() => setPhotos((current) => current.filter((_, i) => i !== index))}
                                    >
                                        <IconX className="size-3.5" />
                                    </button>
                                </span>
                            ))}
                        </div>

                        <p className="text-muted-foreground text-xs">{t("photos.hint", { max: MAX_PHOTOS })}</p>
                    </div>

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{tError(`errors.${error}`)}</AlertDescription>
                        </Alert>
                    )}

                    <div className="flex justify-end">
                        <Button type="button" size="sm" disabled={busy} onClick={() => void submit()}>
                            {busy && <Spinner className="size-4" />}
                            {t("submit")}
                        </Button>
                    </div>
                </div>
            )}
        </SectionCard>
    )
}
