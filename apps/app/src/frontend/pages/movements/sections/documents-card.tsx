"use client"

import { useRef, useState } from "react"
import { toast } from "sonner"
import { IconExternalLink, IconFileText, IconPlus, IconTrash, IconUpload, IconX } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"
import { Label } from "@workspace/ui/components/label"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import { SectionCard } from "@workspace/ui/customs/detail/section-card"
import { EmptyValue } from "@workspace/ui/customs/list/empty-value"
import { cn } from "@workspace/ui/lib/utils"

import { useEdgeStore } from "@workspace/edgestore/client"
import { movementDocumentPath } from "@workspace/edgestore/path"

import { movementErrorKey, type MovementErrorMessage } from "@/frontend/pages/movements/lib/errors"
import { useMovementMutations } from "@/frontend/pages/movements/hooks/use-movement-mutations"
import { MOVEMENT_DOCUMENT_TYPE } from "@/backend/schemas/movement"
import type { MovementDetail, MovementDocumentLeg, MovementDocumentType, MovementDocumentView } from "@/frontend/pages/movements/types"

/** What the bucket accepts. */
const ACCEPTED_FILES = ["application/pdf", "image/jpeg", "image/png"]

/** A photo of the truck being loaded is a photo, whatever the camera calls it. */
const ACCEPTED_PHOTOS = ["image/jpeg", "image/png"]

/** The loading photos have their own block, so the list below leaves them out. */
const PHOTO = "loading-photo"

/** "Everyone on the load" — a paper with no leg. */
const SHARED = "shared"

type Audience = typeof SHARED | MovementDocumentLeg

/** Only a picture can be shown as one; anything else keeps the paper icon. */
const isImage = (document: MovementDocumentView): boolean =>
    document.mimeType?.startsWith("image/") ?? /\.(jpe?g|png)(\?|$)/i.test(document.url)

/**
 * The load's papers. Who reads each is decided by the side of the deal it
 * belongs to: the load's own papers (a POD, a CMR) are everybody's on it, an
 * invoice to the client is between the owner and the client, a receipt from
 * the partner between the owner and the partner. A proof filed on the row
 * with the truck shows here too, and is removed there rather than here.
 *
 * The photos of the loading are papers like any other, but they are read as
 * a set and signed off one by one, so they sit in their own block above the
 * list rather than scattered through it.
 */
export function DocumentsCard({ load }: { load: MovementDetail }) {
    const t = useTranslations("App.loads.documents")
    const f = useFormatter()

    const { removeDocument } = useMovementMutations()
    const [adding, setAdding] = useState(false)

    const canManage = load.permissions.canManageDocuments

    const photos = load.documents.filter((document) => document.type === PHOTO)
    const papers = load.documents.filter((document) => document.type !== PHOTO)

    return (
        <SectionCard
            title={t("title")}
            count={load.documents.length}
            actions={canManage ? (
                <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                    <IconPlus className="size-4" stroke={1.5} />
                    {t("add")}
                </Button>
            ) : undefined}
        >
            {(photos.length > 0 || canManage) && <LoadingPhotos load={load} photos={photos} />}

            {papers.length === 0 ? (
                <EmptyValue label={t("empty")} />
            ) : (
                <ul className="flex flex-col divide-y">
                    {papers.map((document) => (
                        <li key={document.id} className="flex items-center justify-between gap-3 py-2 text-[13px] first:pt-0 last:pb-0">
                            <div className="flex min-w-0 items-center gap-2.5">
                                <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
                                    <IconFileText className="size-4" stroke={1.5} />
                                </span>
                                <div className="flex min-w-0 flex-col">
                                    <span className="flex min-w-0 items-center gap-1.5">
                                        <span className="truncate font-medium">{document.title ?? t(`types.${document.type}`)}</span>
                                        <Badge variant="outline" className="shrink-0 rounded-full font-normal">
                                            {t(`types.${document.type}`)}
                                        </Badge>
                                    </span>
                                    <span className="text-muted-foreground truncate text-xs">
                                        {[
                                            f.dateTime(document.createdAt, { dateStyle: "medium" }),
                                            document.fromExecutor ? t("from-executor") : document.uploadedByName,
                                            load.role === "owner" ? t(`audience.${document.leg ?? SHARED}`) : null,
                                        ].filter(Boolean).join(" · ")}
                                    </span>
                                </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
                                <Button asChild size="icon-sm" variant="ghost" aria-label={t("open")}>
                                    <a href={document.url} target="_blank" rel="noreferrer">
                                        <IconExternalLink className="size-4" stroke={1.5} />
                                    </a>
                                </Button>
                                {canManage && !document.fromExecutor && (
                                    <Button
                                        size="icon-sm"
                                        variant="ghost"
                                        aria-label={t("remove")}
                                        disabled={removeDocument.isPending}
                                        onClick={() => removeDocument.mutate({ id: document.id })}
                                    >
                                        <IconTrash className="size-4" stroke={1.5} />
                                    </Button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {adding && <DocumentDialog load={load} onClose={() => setAdding(false)} />}
        </SectionCard>
    )
}

/**
 * The photos taken while the truck was loaded.
 *
 * The keeper at the client shoots them and anybody on the load may file
 * them; a manager of the company — an owner or an admin — then says they
 * are what they should be. The load is never held back for it: loading
 * with photos still unapproved only raises a flag, which the status event
 * records, so the gap has a name and a time on it afterwards.
 */
function LoadingPhotos({ load, photos }: { load: MovementDetail; photos: MovementDocumentView[] }) {
    const t = useTranslations("App.loads.documents")

    const { approveDocument, removeDocument } = useMovementMutations()

    const canApprove = load.permissions.canApproveDocuments
    const canManage = load.permissions.canManageDocuments

    return (
        <div className="flex flex-col gap-2">
            <span className="text-muted-foreground text-xs font-medium">{t("photos.title")}</span>

            {photos.length === 0 ? (
                <EmptyValue label={t("photos.empty")} />
            ) : (
                <ul className="flex flex-col divide-y">
                    {photos.map((photo) => (
                        <li key={photo.id} className="flex items-center gap-3 py-2 text-[13px] first:pt-0 last:pb-0">
                            <a
                                href={photo.url}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t("open")}
                                className="bg-muted size-12 shrink-0 overflow-hidden rounded-lg"
                            >
                                {isImage(photo) ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={photo.url} alt="" loading="lazy" className="size-full object-cover" />
                                ) : (
                                    <span className="text-muted-foreground flex size-full items-center justify-center">
                                        <IconFileText className="size-4" stroke={1.5} />
                                    </span>
                                )}
                            </a>

                            <div className="flex min-w-0 flex-col">
                                <span className="truncate font-medium">{photo.title ?? t(`types.${photo.type}`)}</span>
                                {/* Whose manager has seen what is the load's own company's business — the same way the flag on the load is */}
                                {load.role === "owner" && (
                                    <span className={cn(
                                        "truncate text-xs",
                                        photo.approvedAt ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400",
                                    )}>
                                        {!photo.approvedAt
                                            ? t("photos.pending")
                                            // The approver's account may be gone by now (approved_by is set
                                            // null with it): the photo stays approved, just by nobody named
                                            : photo.approvedByName
                                                ? t("photos.approved-by", { name: photo.approvedByName })
                                                : t("photos.approved")}
                                    </span>
                                )}
                            </div>

                            <div className="ml-auto flex shrink-0 items-center gap-1">
                                {canApprove && !photo.approvedAt && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={approveDocument.isPending}
                                        onClick={() => approveDocument.mutate({ id: photo.id })}
                                    >
                                        {t("photos.approve")}
                                    </Button>
                                )}
                                {canManage && !photo.fromExecutor && (
                                    <Button
                                        size="icon-sm"
                                        variant="ghost"
                                        aria-label={t("remove")}
                                        disabled={removeDocument.isPending}
                                        onClick={() => removeDocument.mutate({ id: photo.id })}
                                    >
                                        <IconTrash className="size-4" stroke={1.5} />
                                    </Button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

/**
 * Attaching a paper. The upload lands in EdgeStore first and the document
 * row is written with the URL it returns, so a failed upload never leaves a
 * document pointing nowhere.
 */
function DocumentDialog({ load, onClose }: { load: MovementDetail; onClose: () => void }) {
    const t = useTranslations("App.loads.documents")
    const tl = useTranslations("App.loads")

    const { edgestore } = useEdgeStore()
    const { addDocument } = useMovementMutations()

    // A buy-leg paper needs a partner on the other side of it
    const audiences: Audience[] = load.execution === "partner" ? [SHARED, "sell", "buy"] : [SHARED, "sell"]

    const [type, setType] = useState<MovementDocumentType>("pod")
    const [chosen, setChosen] = useState<Audience>(SHARED)
    const [file, setFile] = useState<File | null>(null)
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState<MovementErrorMessage | "uploadFailed" | null>(null)
    const fileRef = useRef<HTMLInputElement>(null)

    const isPending = uploading || addDocument.isPending

    // A loading photo is the load's own record of how it went out: everybody
    // on it sees the same photos, so there is nothing to choose here
    const isPhoto = type === PHOTO
    const audience = isPhoto ? SHARED : chosen
    const accepted = isPhoto ? ACCEPTED_PHOTOS : ACCEPTED_FILES

    async function submit() {
        if (!file || isPending) return

        setError(null)
        setUploading(true)

        try {
            const { url } = await edgestore.apploadFiles.upload({
                file,
                input: { path: movementDocumentPath(load.id, type) },
            })

            if (!url) {
                setError("uploadFailed")
                return
            }

            addDocument.mutate(
                {
                    movementId: load.id,
                    type,
                    leg: audience === SHARED ? undefined : audience,
                    url,
                    title: file.name,
                    size: file.size,
                    mimeType: file.type,
                },
                {
                    onSuccess: onClose,
                    onError: (failure) => setError(movementErrorKey(failure)),
                },
            )
        } catch (failure) {
            console.error(failure)
            setError("uploadFailed")
        } finally {
            setUploading(false)
        }
    }

    return (
        <Dialog open onOpenChange={(next) => { if (!next && !isPending) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("dialog.title")}</DialogTitle>
                    <DialogDescription>{t("dialog.description")}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <Label>{t("dialog.type")}</Label>
                        <Select
                            value={type}
                            onValueChange={(value) => {
                                const next = value as MovementDocumentType
                                setType(next)
                                // A file picked for a paper does not carry over to a photo: the
                                // mime guard only runs when a file is picked, not when the type moves
                                const allowed = next === PHOTO ? ACCEPTED_PHOTOS : ACCEPTED_FILES
                                if (file && !allowed.includes(file.type)) setFile(null)
                            }}
                            disabled={isPending}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper">
                                {MOVEMENT_DOCUMENT_TYPE.map((value) => (
                                    <SelectItem key={value} value={value}>{t(`types.${value}`)}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label>{t("dialog.audience")}</Label>
                        <Select value={audience} onValueChange={(value) => setChosen(value as Audience)} disabled={isPending || isPhoto}>
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper">
                                {audiences.map((value) => (
                                    <SelectItem key={value} value={value}>{t(`audience.${value}`)}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label>{t("dialog.file")}</Label>
                        <div className="flex items-center gap-2">
                            <input
                                ref={fileRef}
                                type="file"
                                className="hidden"
                                accept={isPhoto ? "image/*" : ACCEPTED_FILES.join(",")}
                                // On a phone this is what opens the camera rather than the file tree
                                capture={isPhoto ? "environment" : undefined}
                                onChange={(event) => {
                                    const picked = event.target.files?.[0] ?? null

                                    if (picked && !accepted.includes(picked.type)) {
                                        toast.error(t("dialog.format"))
                                        return
                                    }

                                    setFile(picked)
                                }}
                            />

                            <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => fileRef.current?.click()}>
                                <IconUpload />
                                {file ? t("dialog.replace") : t("dialog.pick")}
                            </Button>

                            {file && (
                                <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
                                    <span className="truncate">{file.name}</span>
                                    <button type="button" disabled={isPending} aria-label={t("dialog.clear")} onClick={() => setFile(null)}>
                                        <IconX className="size-3.5" />
                                    </button>
                                </span>
                            )}
                        </div>
                        <p className="text-muted-foreground text-xs">{t("dialog.hint")}</p>
                    </div>

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{error === "uploadFailed" ? t("dialog.upload-failed") : tl(`errors.${error}`)}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" disabled={isPending} onClick={onClose}>
                        {tl("dialogs.back")}
                    </Button>
                    <Button disabled={!file || isPending} onClick={() => void submit()}>
                        {isPending && <Spinner className="size-4" />}
                        {t("dialog.submit")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
