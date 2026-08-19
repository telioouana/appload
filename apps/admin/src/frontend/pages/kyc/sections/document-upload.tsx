"use client"

import { useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { IconLoader2, IconUpload, IconX } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { useEdgeStore } from "@workspace/edgestore/client"
import type { KycDocumentType, KycPage, KycSubjectType } from "@workspace/db/types"

import { Alert } from "@workspace/ui/components/alert"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Button } from "@workspace/ui/components/button"

import { useTRPC } from "@/backend/api/client"
import { domainErrorCode } from "@/lib/trpc-error"

const ACCEPTED = ["application/pdf", "image/jpeg", "image/png"]
const MAX_BYTES = 5 * 1024 * 1024
const MAX_PAGES = 5

const UPLOAD_ERROR_CODES = [
    "DOCUMENT_NOT_APPLICABLE",
    "INVALID_DOCUMENT_URL",
    "NOT_ALLOWED",
    "NOT_FOUND",
    "UPLOAD_FAILED",
    "FILE_TOO_LARGE",
    "FILE_TYPE",
    "UNKNOWN",
] as const

type UploadErrorCode = (typeof UPLOAD_ERROR_CODES)[number]

/**
 * Adds a document to one checklist slot.
 *
 * Two-phase commit: every page uploads to EdgeStore as `temporary`, the row
 * is written, and only then are the files confirmed. If the mutation fails
 * the temporary blobs expire on their own, so a failed submission never
 * leaves an orphaned ID scan sitting in storage.
 */
export function DocumentUpload({
    subjectType,
    subjectId,
    type,
    needsExpiry,
    replacing,
    onUploaded,
}: {
    subjectType: KycSubjectType
    subjectId: string
    type: KycDocumentType
    needsExpiry: boolean
    /** Set when this upload supersedes a rejected document */
    replacing?: string
    onUploaded: () => Promise<void> | void
}) {
    const t = useTranslations("Admin.partners.review")
    const trpc = useTRPC()
    const { edgestore } = useEdgeStore()
    const inputRef = useRef<HTMLInputElement>(null)

    const [files, setFiles] = useState<File[]>([])
    const [expiresAt, setExpiresAt] = useState("")
    const [issuedAt, setIssuedAt] = useState("")
    const [documentNumber, setDocumentNumber] = useState("")
    const [error, setError] = useState<UploadErrorCode | null>(null)
    const [busy, setBusy] = useState(false)

    const upload = useMutation(trpc.kyc.upload.mutationOptions())

    const pick = (list: FileList | null) => {
        if (!list) return
        setError(null)

        const chosen = [...list].slice(0, MAX_PAGES - files.length)

        if (chosen.some((file) => !ACCEPTED.includes(file.type))) return setError("FILE_TYPE")
        if (chosen.some((file) => file.size > MAX_BYTES)) return setError("FILE_TOO_LARGE")

        setFiles((current) => [...current, ...chosen])
    }

    const submit = async () => {
        if (files.length === 0) return

        setBusy(true)
        setError(null)

        try {
            const pages: KycPage[] = []

            for (const file of files) {
                const result = await edgestore.kycFiles.upload({
                    file,
                    input: { subjectType, subjectId, docType: type },
                    // Not confirmed until the row exists
                    options: { temporary: true },
                })

                if (!result?.url) {
                    setError("UPLOAD_FAILED")
                    return
                }

                pages.push({ url: result.url, size: file.size, mimeType: file.type })
            }

            await upload.mutateAsync({
                subjectType,
                subjectId,
                type,
                pages,
                expiresAt: expiresAt || undefined,
                issuedAt: issuedAt || undefined,
                documentNumber: documentNumber.trim() || undefined,
            })

            // The row is durable; the blobs can stop being temporary
            await Promise.all(
                pages.map((page) => edgestore.kycFiles.confirmUpload({ url: page.url })),
            )

            setFiles([])
            setExpiresAt("")
            setIssuedAt("")
            setDocumentNumber("")
            await onUploaded()
        } catch (cause) {
            setError(domainErrorCode<UploadErrorCode>(cause, UPLOAD_ERROR_CODES, "UNKNOWN"))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="border-muted flex flex-col gap-3 rounded-lg border border-dashed p-3">
            {error && <Alert variant="destructive">{t(`errors.${error}`)}</Alert>}

            <div className="flex flex-wrap items-center gap-2">
                <input
                    ref={inputRef}
                    type="file"
                    multiple
                    hidden
                    accept={ACCEPTED.join(",")}
                    onChange={(event) => {
                        pick(event.target.files)
                        // Let the same file be re-picked after a removal
                        event.target.value = ""
                    }}
                />

                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || files.length >= MAX_PAGES}
                    onClick={() => inputRef.current?.click()}
                >
                    <IconUpload className="size-4" stroke={1.5} />
                    {replacing ? t("replace") : t("add-pages")}
                </Button>

                {files.map((file, index) => (
                    <span
                        key={`${file.name}-${index}`}
                        className="bg-muted inline-flex max-w-56 items-center gap-1 rounded-full px-2.5 py-1 text-xs"
                    >
                        <span className="truncate">{file.name}</span>
                        <button
                            type="button"
                            disabled={busy}
                            aria-label={t("remove-page")}
                            onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                        >
                            <IconX className="size-3.5" stroke={1.5} />
                        </button>
                    </span>
                ))}
            </div>

            {files.length > 0 && (
                <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <Field label={t("issued")}>
                            <Input type="date" value={issuedAt} disabled={busy} onChange={(e) => setIssuedAt(e.target.value)} />
                        </Field>

                        <Field label={needsExpiry ? `${t("expiry")} *` : t("expiry")}>
                            <Input type="date" value={expiresAt} disabled={busy} onChange={(e) => setExpiresAt(e.target.value)} />
                        </Field>

                        <Field label={t("number")}>
                            <Input value={documentNumber} disabled={busy} onChange={(e) => setDocumentNumber(e.target.value)} />
                        </Field>
                    </div>

                    <div className="flex justify-end">
                        <Button type="button" size="sm" disabled={busy} onClick={submit}>
                            {busy ? <IconLoader2 className="size-4 animate-spin" /> : <IconUpload className="size-4" />}
                            {t("submit-upload")}
                        </Button>
                    </div>
                </>
            )}
        </div>
    )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <Label className="text-xs">{label}</Label>
            {children}
        </div>
    )
}
