"use client"

import { toast } from "sonner"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { IconExternalLink, IconFilePlus, IconTrash } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"
import type { OrderDocument } from "@workspace/db/orders"

import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"

import { useTRPC } from "@/backend/api/client"
import { domainErrorCode } from "@/lib/trpc-error"
import { isProofOfPayment } from "@workspace/domain/orders/payments"

import { SectionCard } from "@/frontend/pages/order/sections/section-card"
import { DOCUMENT_ERROR_CODES, formType, invoicePartyOf } from "./add-document-dialog"

/**
 * The order's document library: everything attached — PODs, invoices, debit
 * and credit notes, proofs of payment, evidence — with the amount and the
 * structured cause each carries. Adding one opens a dialog the caller owns.
 * Voiding one is a soft delete that reverts whatever it shifted, and the row
 * then leaves this list, because the query only returns live documents; the
 * void itself stays visible in the order's activity.
 */
export function DocumentsCard({
    orderId,
    documents,
    canDelete,
    canVoidPayment,
    onAdd,
}: {
    orderId: string
    documents: OrderDocument[]
    canDelete: boolean
    canVoidPayment: boolean
    onAdd: () => void
}) {
    const t = useTranslations("Admin.orders.documents")
    const f = useFormatter()

    const trpc = useTRPC()
    const queryClient = useQueryClient()
    const { mutateAsync: voidDocument } = useMutation(trpc.documents.softDelete.mutationOptions())

    function invalidate() {
        queryClient.invalidateQueries(trpc.order.get.queryFilter({ orderId }))
        queryClient.invalidateQueries(trpc.orders.pathFilter())
        queryClient.invalidateQueries(trpc.documents.paymentSummary.queryFilter({ orderId }))
        queryClient.invalidateQueries(trpc.order.transitionOptions.queryFilter({ orderId }))
    }

    /** The mutation's warning, if any, as a toast — the void itself is done either way */
    function toastWarning(warning: "SHEET_FAILED" | "RECOMPUTE_PENDING" | undefined, kind: "note" | "payment") {
        if (warning === "RECOMPUTE_PENDING") {
            toast(t("recomputePending"))
        } else if (warning === "SHEET_FAILED") {
            toast(t(kind === "payment" ? "paymentSheetWarning" : "sheetWarning"))
        }
    }

    async function remove(document: OrderDocument) {
        try {
            const result = await voidDocument({ documentId: document.id })
            toastWarning(result.warning, isProofOfPayment(document.type) ? "payment" : "note")
            invalidate()
        } catch (error) {
            console.error(error)
            const code = domainErrorCode(error, DOCUMENT_ERROR_CODES, "UNKNOWN")
            toast(code === "UNKNOWN" ? t("deleteError") : t(`errors.${code}`))
            invalidate()
        }
    }

    return (
        <SectionCard
            title={t("title")}
            count={documents.length}
            actions={
                <Button size="sm" variant="outline" onClick={onAdd}>
                    <IconFilePlus />
                    {t("add")}
                </Button>
            }
        >
                {documents.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">{t("empty")}</p>
                ) : (
                    <ul className="flex flex-col divide-y">
                        {documents.map((document) => {
                            const pop = isProofOfPayment(document.type)
                            // Invoices read "Invoice · Shipper" like notes and proofs;
                            // rows stored before the party column was filled derive it
                            // from their type
                            const documentParty = document.party ?? invoicePartyOf(document.type)

                            return (
                                <li key={document.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <Badge variant="outline">{t(`types.${formType(document.type)}`)}</Badge>
                                            {documentParty && (
                                                <span className="text-xs text-muted-foreground">{t(`parties.${documentParty}`)}</span>
                                            )}
                                            {document.total && (
                                                <span className="text-xs font-medium tabular-nums">
                                                    {f.number(Number(document.total), { maximumFractionDigits: 2 })} {document.currency}
                                                </span>
                                            )}
                                            {/* The bank value date is what matters for a proof;
                                                the upload date lives on the line below */}
                                            {pop && (
                                                <span className="text-xs text-muted-foreground">
                                                    {f.dateTime(document.paidAt ?? document.createdAt, { dateStyle: "medium" })}
                                                </span>
                                            )}
                                            {/* Notes show their structured reason (legacy notes only
                                                have the free text below) */}
                                            {document.reasonCode && (
                                                <span className="text-xs text-muted-foreground">
                                                    {t(`reasons.${document.reasonCode}`)}
                                                    {document.details?.stage && ` · ${t(`stages.${document.details.stage}`)}`}
                                                    {document.details?.days !== undefined && ` · ${document.details.days}d`}
                                                </span>
                                            )}
                                            {/* Proofs show their bank reference, invoices their number,
                                                notes their description — the server only stores a
                                                reason for those types */}
                                            {document.reason && (
                                                <span className="min-w-0 truncate text-xs text-muted-foreground">
                                                    {document.reason}
                                                </span>
                                            )}
                                        </div>
                                        <span className="truncate text-xs text-muted-foreground">
                                            {document.title ?? document.url.split("/").pop()}
                                            {" · "}
                                            {f.dateTime(document.createdAt, { dateStyle: "medium" })}
                                        </span>
                                    </div>

                                    <Button asChild size="icon-sm" variant="ghost" aria-label={t("open")}>
                                        <a href={document.url} target="_blank" rel="noreferrer">
                                            <IconExternalLink />
                                        </a>
                                    </Button>

                                    {/* Voiding a proof re-derives the leg's paid columns, so
                                        it needs the payment:void grant on top of document:delete */}
                                    {canDelete && (!pop || canVoidPayment) && (
                                        <Button
                                            size="icon-sm"
                                            variant="ghost"
                                            className="text-destructive"
                                            aria-label={pop ? t("voidPayment") : t("void")}
                                            onClick={() => remove(document)}
                                        >
                                            <IconTrash />
                                        </Button>
                                    )}
                                </li>
                            )
                        })}
                    </ul>
                )}
        </SectionCard>
    )
}
