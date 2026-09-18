"use client"

import { IconCashBanknote, IconExternalLink, IconPlus } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"
import type { DocumentParty, OrderDocument } from "@workspace/db/orders"

import { Button } from "@workspace/ui/components/button"

import { isProofOfPayment } from "@workspace/domain/orders/payments"

/**
 * One party's proofs of payment on the details page: the live proofs from
 * the order's document library, newest payment first, plus the shortcut to
 * record another. Amounts keep their cents — proofs are recorded to the
 * cent, unlike the rounded list-row money.
 */
export function PaymentLedger({
    party,
    documents,
    currency,
    canRecord,
    onRecord,
}: {
    party: DocumentParty
    documents: OrderDocument[]
    currency: string | null
    canRecord: boolean
    onRecord: () => void
}) {
    const t = useTranslations("Admin.orders.detailPage")
    const f = useFormatter()

    // Legacy rows may lack paidAt in TS (Date | null); the sort tolerates it
    // by falling back to the upload date so nothing throws at render
    const proofs = documents
        .filter((document) => isProofOfPayment(document.type) && document.party === party)
        .sort((a, b) => (b.paidAt ?? b.createdAt).getTime() - (a.paidAt ?? a.createdAt).getTime())

    return (
        <div className="@container/ledger flex flex-col gap-2 rounded-xl border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
                    <IconCashBanknote className="size-4 text-muted-foreground" />
                    {t("payments.proofs")}
                    <span className="tabular-nums text-muted-foreground">({proofs.length})</span>
                </span>

                {/* The button cannot give way — a nowrap label on a shrink-0
                    box — so it wraps under the heading when the two no longer
                    fit, and once the column is narrower than the button itself
                    it keeps only its plus. Two parties side by side inside a
                    700px page column leaves about 150px each at a 1024px
                    window, which is where it used to hang over the border */}
                {canRecord && (
                    <Button
                        size="sm"
                        variant="outline"
                        aria-label={t("payments.recordPayment")}
                        className="ml-auto @max-[200px]/ledger:size-8 @max-[200px]/ledger:px-0"
                        onClick={onRecord}
                    >
                        <IconPlus />
                        <span className="@max-[200px]/ledger:hidden">{t("payments.recordPayment")}</span>
                    </Button>
                )}
            </div>

            {proofs.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("payments.noProofs")}</p>
            ) : (
                <>
                    {/* A leg with proofs is POP-governed: its paid figures above
                        come from these rows, not from the edit form */}
                    <p className="text-xs italic text-muted-foreground">{t("payments.derivedHint")}</p>
                    <ul className="flex flex-col divide-y">
                        {proofs.map((proof) => (
                            <li key={proof.id} className="flex items-center gap-3 py-1.5 first:pt-0 last:pb-0">
                                <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                                    <span className="tabular-nums text-muted-foreground">
                                        {f.dateTime(proof.paidAt ?? proof.createdAt, { dateStyle: "medium" })}
                                    </span>
                                    <span className="font-medium tabular-nums">
                                        {f.number(Number(proof.total ?? 0), { maximumFractionDigits: 2 })} {proof.currency ?? currency}
                                    </span>
                                    {proof.reason && (
                                        <span className="min-w-0 truncate text-muted-foreground">{proof.reason}</span>
                                    )}
                                </div>

                                <Button asChild size="icon-sm" variant="ghost" aria-label={t("payments.open")}>
                                    <a href={proof.url} target="_blank" rel="noreferrer">
                                        <IconExternalLink />
                                    </a>
                                </Button>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </div>
    )
}
