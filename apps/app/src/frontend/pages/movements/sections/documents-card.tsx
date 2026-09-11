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

import { useEdgeStore } from "@workspace/edgestore/client"
import { movementDocumentPath } from "@workspace/edgestore/path"

import { movementErrorKey, type MovementErrorMessage } from "@/frontend/pages/movements/lib/errors"
import { useMovementMutations } from "@/frontend/pages/movements/hooks/use-movement-mutations"
import { MOVEMENT_DOCUMENT_TYPE } from "@/backend/schemas/movement"
import type { MovementDetail, MovementDocumentLeg, MovementDocumentType } from "@/frontend/pages/movements/types"

/** What the bucket accepts. */
const ACCEPTED_FILES = ["application/pdf", "image/jpeg", "image/png"]

/** "Everyone on the load" — a paper with no leg. */
const SHARED = "shared"

type Audience = typeof SHARED | MovementDocumentLeg

/**
 * The load's papers. Who reads each is decided by the side of the deal it
 * belongs to: the load's own papers (a POD, a CMR) are everybody's on it, an
 * invoice to the client is between the owner and the client, a receipt from
 * the partner between the owner and the partner. A proof filed on the row
 * with the truck shows here too, and is removed there rather than here.
 */
export function DocumentsCard({ load }: { load: MovementDetail }) {
    const t = useTranslations("App.loads.documents")
    const f = useFormatter()

    const { removeDocument } = useMovementMutations()
    const [adding, setAdding] = useState(false)

    const canManage = load.permissions.canManageDocuments

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
            {load.documents.length === 0 ? (
                <EmptyValue label={t("empty")} />
            ) : (
                <ul className="flex flex-col divide-y">
                    {load.documents.map((document) => (
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
    const [audience, setAudience] = useState<Audience>(SHARED)
    const [file, setFile] = useState<File | null>(null)
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState<MovementErrorMessage | "uploadFailed" | null>(null)
    const fileRef = useRef<HTMLInputElement>(null)

    const isPending = uploading || addDocument.isPending

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
                        <Select value={type} onValueChange={(value) => setType(value as MovementDocumentType)} disabled={isPending}>
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
                        <Select value={audience} onValueChange={(value) => setAudience(value as Audience)} disabled={isPending}>
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
                                accept={ACCEPTED_FILES.join(",")}
                                onChange={(event) => {
                                    const picked = event.target.files?.[0] ?? null

                                    if (picked && !ACCEPTED_FILES.includes(picked.type)) {
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
