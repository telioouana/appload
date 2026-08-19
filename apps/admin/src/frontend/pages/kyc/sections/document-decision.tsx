"use client"

import { useState } from "react"
import { IconAlertTriangle, IconCheck, IconLoader2, IconX } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import type { KycDocument } from "@workspace/db/kyc-documents"

import { Alert } from "@workspace/ui/components/alert"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"

import { OWNERSHIP_DOC } from "@/lib/kyc/requirements"

export type ReviewPayload = {
    documentId: string
    decision: "approved" | "rejected"
    expiresAt?: string
    issuedAt?: string
    documentNumber?: string
    rejectionReason?: string
    ownerName?: string
    ownerNuit?: string
}

/**
 * The decision form for one document.
 *
 * The rules it renders are the same ones the server enforces: an expiring
 * document cannot be approved without a date, a rejection cannot be filed
 * without a reason, and a proof of ownership must have its owner
 * transcribed. The UI disables those buttons; the mutation refuses them.
 */
export function DocumentDecision({
    document,
    needsExpiry,
    canReview,
    isPending,
    error,
    carrierNuit,
    onSubmit,
}: {
    document: KycDocument
    needsExpiry: boolean
    canReview: boolean
    isPending: boolean
    error: string | null
    carrierNuit?: string | null
    onSubmit: (payload: ReviewPayload) => void
}) {
    const t = useTranslations("Admin.partners.review")

    const [expiresAt, setExpiresAt] = useState(document.expiresAt ?? "")
    const [issuedAt, setIssuedAt] = useState(document.issuedAt ?? "")
    const [documentNumber, setDocumentNumber] = useState(document.documentNumber ?? "")
    const [reason, setReason] = useState("")
    const [ownerName, setOwnerName] = useState("")
    const [ownerNuit, setOwnerNuit] = useState("")

    const isOwnership = document.type === OWNERSHIP_DOC
    const decided = document.status !== "pending"

    const normalize = (value: string) => value.replace(/\s+/g, "")
    // Shown before approving, not after: the reviewer decides knowing that
    // this approval is what flags the carrier
    const mismatch = isOwnership && Boolean(ownerNuit) && Boolean(carrierNuit)
        && normalize(ownerNuit) !== normalize(carrierNuit ?? "")

    const canApprove = canReview && !decided
        && (!needsExpiry || Boolean(expiresAt))
        && (!isOwnership || Boolean(ownerNuit))

    const canRejectNow = canReview && !decided && reason.trim().length > 0

    return (
        <div className="border-muted flex flex-col gap-3 rounded-lg border p-3">
            {error && <Alert variant="destructive">{error}</Alert>}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label={t("issued")}>
                    <Input type="date" value={issuedAt} disabled={decided} onChange={(e) => setIssuedAt(e.target.value)} />
                </Field>

                <Field label={needsExpiry ? `${t("expiry")} *` : t("expiry")}>
                    <Input type="date" value={expiresAt} disabled={decided} onChange={(e) => setExpiresAt(e.target.value)} />
                </Field>

                <Field label={t("number")}>
                    <Input value={documentNumber} disabled={decided} onChange={(e) => setDocumentNumber(e.target.value)} />
                </Field>
            </div>

            {needsExpiry && !expiresAt && !decided && (
                <p className="text-muted-foreground text-xs">{t("expiry-required")}</p>
            )}

            {isOwnership && (
                <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label={t("owner-name")}>
                            <Input value={ownerName} disabled={decided} onChange={(e) => setOwnerName(e.target.value)} />
                        </Field>

                        <Field label={`${t("owner-nuit")} *`}>
                            <Input value={ownerNuit} disabled={decided} onChange={(e) => setOwnerNuit(e.target.value)} />
                        </Field>
                    </div>

                    {carrierNuit && (
                        <p className="text-muted-foreground text-xs">{t("owner-hint", { nuit: carrierNuit })}</p>
                    )}

                    {mismatch && (
                        <Alert variant="destructive" className="flex items-start gap-2">
                            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
                            <span className="text-sm">{t("owner-mismatch")}</span>
                        </Alert>
                    )}
                </div>
            )}

            <Field label={t("reason")}>
                <Textarea
                    value={reason}
                    disabled={decided}
                    rows={2}
                    placeholder={t("reason-required")}
                    onChange={(e) => setReason(e.target.value)}
                />
            </Field>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                    variant="outline"
                    disabled={!canRejectNow || isPending}
                    onClick={() => onSubmit({
                        documentId: document.id,
                        decision: "rejected",
                        rejectionReason: reason.trim(),
                    })}
                >
                    {isPending ? <IconLoader2 className="size-4 animate-spin" /> : <IconX className="size-4" />}
                    {t("reject")}
                </Button>

                <Button
                    disabled={!canApprove || isPending}
                    onClick={() => onSubmit({
                        documentId: document.id,
                        decision: "approved",
                        expiresAt: expiresAt || undefined,
                        issuedAt: issuedAt || undefined,
                        documentNumber: documentNumber.trim() || undefined,
                        ownerName: ownerName.trim() || undefined,
                        ownerNuit: ownerNuit.trim() || undefined,
                    })}
                >
                    {isPending ? <IconLoader2 className="size-4 animate-spin" /> : <IconCheck className="size-4" />}
                    {t("approve")}
                </Button>
            </div>
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
