"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconExternalLink, IconFilePlus, IconTrash, IconUpload, IconX } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"
import { CURRENCY } from "@workspace/db/types"
import {
    DOCUMENT_PARTY,
    ORDER_DOCUMENT_TYPE,
    type DemurrageStage,
    type DocumentParty,
    type NoteReason,
    type Order,
    type OrderDocument,
    type OrderDocumentType,
} from "@workspace/db/orders"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Label } from "@workspace/ui/components/label"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"

import { useEdgeStore } from "@workspace/edgestore/client"
import { orderDocumentPath } from "@workspace/edgestore/path"

import { useTRPC } from "@/backend/api/client"
import { domainErrorCode } from "@/lib/trpc-error"
import { isProofOfPayment } from "@/lib/orders/payments"
import { DAMAGE, DEMURRAGE, DEMURRAGE_STAGE, NOTE_REASON, demurrageFieldsComplete, descriptionRequired } from "@/lib/orders/note-reasons"

const ACCEPTED_FILES = ["application/pdf", "image/jpeg", "image/png"]
const NOTE_TYPES: OrderDocumentType[] = ["debit-note", "credit-note"]

// Domain codes the server puts in TRPCError.message; anything else lands
// on UNKNOWN. Every entry has an `errors.*` message in the card namespace,
// and every code documents.create/softDelete throw is listed here — the
// client pre-validates most of them, so they only surface when a stale
// tab and the server disagree.
const DOCUMENT_ERROR_CODES = [
    "POP_FIELDS_REQUIRED",
    "POP_PAID_AT_FUTURE",
    "POP_ORDER_NOT_BOOKED",
    "POP_LEG_CURRENCY_MISSING",
    "POP_CURRENCY_MISMATCH",
    "NOTE_FIELDS_REQUIRED",
    "NOTE_REASON_REQUIRED",
    "NOTE_DESCRIPTION_REQUIRED",
    "NOTE_DEMURRAGE_FIELDS_REQUIRED",
    "NOTE_CURRENCY_MISMATCH",
    "NOTE_LEG_CURRENCY_MISSING",
    "NOT_ALLOWED",
    "VERSION_CONFLICT",
    "UNKNOWN",
] as const

// Mirrors of the server's zod bounds (noteDetailsSchema) so a rejected note
// never costs an orphaned upload
const MAX_DEMURRAGE_DAYS = 365
const MAX_DAMAGED_PERCENT = 100

/** A preset from outside the card ("Record payment"): nonce forces a fresh
 *  identity per click so the same type/party can be requested twice */
export type DocumentPreset = {
    type: OrderDocumentType
    party?: DocumentParty
    nonce: number
}

/** The invoice number/date a party leg currently carries, offered as defaults on an invoice upload */
export type InvoiceDefaults = Record<DocumentParty, { number: string | null; date: Date | null }>

/**
 * What the order already says about demurrage and damage — a demurrage or
 * damage note is prefilled with it so the operator sees (and replaces) the
 * current value rather than blindly overwriting it
 */
export type NoteDefaults = {
    demurrageDays: Record<DemurrageStage, number | null>
    damagedPercent: string | null
    claimed: boolean | null
}

/** The party an invoice document type belongs to */
const invoicePartyOf = (type: OrderDocumentType): DocumentParty | null =>
    type === "shipper-invoice" ? "shipper" : type === "carrier-invoice" ? "carrier" : null

/**
 * What the form's type picker offers. Invoices are ONE choice ("Invoice")
 * plus the party picker — like notes and proofs of payment — and resolve to
 * the party-specific stored type on save, so nothing already stored changes.
 */
const INVOICE_OPTION = "invoice" as const
type FormType = Exclude<OrderDocumentType, "shipper-invoice" | "carrier-invoice"> | typeof INVOICE_OPTION

const FORM_TYPES: FormType[] = ORDER_DOCUMENT_TYPE.flatMap((option): FormType[] =>
    option === "shipper-invoice" ? [INVOICE_OPTION] : option === "carrier-invoice" ? [] : [option],
)

/** The stored type for a form choice (an invoice needs its party first) */
const storedType = (type: FormType, party: DocumentParty | undefined): OrderDocumentType | null =>
    type !== INVOICE_OPTION ? type : party === "shipper" ? "shipper-invoice" : party === "carrier" ? "carrier-invoice" : null

/** The form choice for a stored type (presets and the list badge) */
const formType = (type: OrderDocumentType): FormType => (invoicePartyOf(type) ? INVOICE_OPTION : (type as FormType))

/** A Date as the ISO day (YYYY-MM-DD) a date input holds, in the viewer's calendar */
function toISODay(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    return `${date.getFullYear()}-${month}-${day}`
}

/** Local calendar day as an ISO date (YYYY-MM-DD) — the value a date input holds */
function todayISO(): string {
    return toISODay(new Date())
}

/**
 * The chosen calendar day is sent as UTC midnight so the sheet (formatted
 * in UTC server-side) and the UI (CAT) show the same day; the server checks
 * that day is not after today in Africa/Maputo.
 */
function isoDayToUtcMidnight(iso: string): Date | null {
    const [y, m, d] = iso.split("-").map(Number)
    if (!y || !m || !d) return null
    return new Date(Date.UTC(y, m - 1, d))
}

/** Digits and at most one decimal point */
const sanitizeDecimal = (value: string) => value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1")

/** Cents comparison — the server rounds to cents, so the client must not compare raw doubles */
const cents = (n: number) => Math.round(n * 100)

/**
 * Everything the add-document form holds. One object so a cancel, a preset
 * or a type switch resets or seeds the whole thing in one place, and no
 * field can survive a reset by being forgotten.
 */
type Draft = {
    type: FormType
    party?: DocumentParty
    total: string
    paidAt: string
    reason: string
    reasonCode?: NoteReason
    demurrageStage?: DemurrageStage
    demurrageDays: string
    // Damage share/claim: seeded from the order when "damage" is picked (so
    // the form shows what the order says right now); only fields the
    // operator actually touched are sent, so an untouched value seeded
    // earlier can never overwrite a newer one on the order
    damagedPercent: string
    claimed: boolean
    damageTouched: { percent: boolean; claimed: boolean }
    // Invoice number/date, seeded from the leg when its party is picked; an
    // unchanged field is not sent, so an upload alone changes nothing
    invoiceNumber: string
    invoiceDate: string
    invoiceSeed: { party: DocumentParty; number: string; date: string } | null
    file: File | null
}

const emptyDraft = (): Draft => ({
    type: "pod",
    total: "",
    paidAt: todayISO(),
    reason: "",
    demurrageDays: "",
    damagedPercent: "",
    claimed: false,
    damageTouched: { percent: false, claimed: false },
    invoiceNumber: "",
    invoiceDate: "",
    invoiceSeed: null,
    file: null,
})

/** The invoice fields as the leg currently has them (a leg without a date leaves the field empty) */
function seedInvoice(draft: Draft, party: DocumentParty | null, defaults: InvoiceDefaults): Draft {
    if (party === null) {
        return { ...draft, invoiceNumber: "", invoiceDate: "", invoiceSeed: null }
    }

    const number = defaults[party].number ?? ""
    const date = defaults[party].date ? toISODay(defaults[party].date) : ""

    return { ...draft, invoiceNumber: number, invoiceDate: date, invoiceSeed: { party, number, date } }
}

type Update = (patch: Partial<Draft>) => void

/** Label + control with the accessible association wired up */
function Field({ label, className, children }: { label: string; className?: string; children: (id: string) => ReactNode }) {
    const id = useId()

    return (
        <div className={className ?? "flex flex-col gap-1.5"}>
            <Label htmlFor={id}>{label}</Label>
            {children(id)}
        </div>
    )
}

/** Amount input next to the (read-only) leg currency */
function AmountField({ label, value, currency, onChange }: { label: string; value: string; currency: string; onChange: (value: string) => void }) {
    const t = useTranslations("Admin.orders.documents")

    return (
        <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field label={label}>
                {(id) => (
                    <Input
                        id={id}
                        inputMode="decimal"
                        value={value}
                        onChange={(event) => onChange(sanitizeDecimal(event.target.value))}
                        placeholder="0.00"
                    />
                )}
            </Field>
            <div className="flex flex-col gap-1.5">
                <Label>{t("form.currency")}</Label>
                <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                    {currency}
                </div>
            </div>
        </div>
    )
}

function NoteFields({ draft, update, currency, noteDefaults }: { draft: Draft; update: Update; currency: string | null; noteDefaults: NoteDefaults }) {
    const t = useTranslations("Admin.orders.documents")
    const isDemurrage = draft.reasonCode === DEMURRAGE
    const isDamage = draft.reasonCode === DAMAGE

    return (
        <>
            <AmountField label={t("form.total")} value={draft.total} currency={currency ?? "—"} onChange={(total) => update({ total })} />

            {draft.party && currency === null && (
                <p className="text-xs text-destructive">
                    {t("form.currencyMissing", { party: t(`parties.${draft.party}`) })}
                </p>
            )}

            <Field label={t("form.reasonCode")}>
                {(id) => (
                    <Select
                        value={draft.reasonCode}
                        onValueChange={(value) => {
                            const next = value as NoteReason
                            update({
                                reasonCode: next,
                                // Demurrage: the days follow the stage pick.
                                // Damage: seeded from what the order says right
                                // now, so the operator sees (and replaces) the
                                // current value — read at pick time, never from
                                // a stale render
                                demurrageStage: undefined,
                                demurrageDays: "",
                                damagedPercent: next === DAMAGE ? noteDefaults.damagedPercent ?? "" : "",
                                claimed: next === DAMAGE ? noteDefaults.claimed ?? false : false,
                                damageTouched: { percent: false, claimed: false },
                            })
                        }}
                    >
                        <SelectTrigger id={id} className="w-full">
                            <SelectValue placeholder={t("form.reasonCodePlaceholder")} />
                        </SelectTrigger>
                        <SelectContent position="popper">
                            {NOTE_REASON.map((option) => (
                                <SelectItem key={option} value={option}>{t(`reasons.${option}`)}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </Field>

            {isDemurrage && (
                <>
                    <div className="grid grid-cols-[1fr_auto] gap-3">
                        <Field label={t("form.demurrageStage")}>
                            {(id) => (
                                <Select
                                    value={draft.demurrageStage}
                                    onValueChange={(value) => {
                                        const stage = value as DemurrageStage
                                        // Prefill with what the order already charges
                                        // for that stage — the note replaces it
                                        const current = noteDefaults.demurrageDays[stage]
                                        update({ demurrageStage: stage, demurrageDays: current === null ? "" : String(current) })
                                    }}
                                >
                                    <SelectTrigger id={id} className="w-full">
                                        <SelectValue placeholder={t("form.demurrageStagePlaceholder")} />
                                    </SelectTrigger>
                                    <SelectContent position="popper">
                                        {DEMURRAGE_STAGE.map((option) => (
                                            <SelectItem key={option} value={option}>{t(`stages.${option}`)}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </Field>
                        <Field label={t("form.demurrageDays")} className="flex w-28 flex-col gap-1.5">
                            {(id) => (
                                <Input
                                    id={id}
                                    inputMode="numeric"
                                    value={draft.demurrageDays}
                                    onChange={(event) => update({ demurrageDays: event.target.value.replace(/[^0-9]/g, "") })}
                                    placeholder="0"
                                />
                            )}
                        </Field>
                    </div>
                    <p className="text-xs text-muted-foreground">{t("form.demurrageHint")}</p>
                </>
            )}

            {isDamage && (
                <>
                    <div className="grid grid-cols-[auto_1fr] items-end gap-3">
                        <Field label={t("form.damagedPercent")} className="flex w-32 flex-col gap-1.5">
                            {(id) => (
                                <Input
                                    id={id}
                                    inputMode="decimal"
                                    value={draft.damagedPercent}
                                    onChange={(event) => update({
                                        damagedPercent: sanitizeDecimal(event.target.value),
                                        damageTouched: { ...draft.damageTouched, percent: true },
                                    })}
                                    placeholder="0"
                                />
                            )}
                        </Field>
                        <label className="flex h-9 items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                className="size-4 accent-primary"
                                checked={draft.claimed}
                                onChange={(event) => update({
                                    claimed: event.target.checked,
                                    damageTouched: { ...draft.damageTouched, claimed: true },
                                })}
                            />
                            {t("form.claimed")}
                        </label>
                    </div>
                    <p className="text-xs text-muted-foreground">{t("form.damageHint")}</p>
                </>
            )}

            <Field label={t("form.description")}>
                {(id) => (
                    <>
                        <Textarea
                            id={id}
                            rows={2}
                            value={draft.reason}
                            maxLength={1000}
                            onChange={(event) => update({ reason: event.target.value })}
                            placeholder={t("form.descriptionPlaceholder")}
                        />
                        {draft.reasonCode !== undefined && descriptionRequired(draft.reasonCode) && draft.reason.trim().length === 0 && (
                            <p className="text-xs text-muted-foreground">{t("form.descriptionRequired")}</p>
                        )}
                    </>
                )}
            </Field>
        </>
    )
}

function InvoiceFields({ draft, update, party }: { draft: Draft; update: Update; party: DocumentParty }) {
    const t = useTranslations("Admin.orders.documents")

    return (
        <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t("form.invoiceNumber")}>
                    {(id) => (
                        <Input
                            id={id}
                            value={draft.invoiceNumber}
                            maxLength={100}
                            onChange={(event) => update({ invoiceNumber: event.target.value })}
                            placeholder={t("form.invoiceNumberPlaceholder")}
                        />
                    )}
                </Field>
                <Field label={t("form.invoiceDate")}>
                    {(id) => (
                        <Input
                            id={id}
                            type="date"
                            value={draft.invoiceDate}
                            onChange={(event) => update({ invoiceDate: event.target.value })}
                        />
                    )}
                </Field>
            </div>
            <p className="text-xs text-muted-foreground">
                {t("form.invoiceHint", { party: t(`parties.${party}`) })}
            </p>
        </>
    )
}

function PopFields({ draft, update, currency }: { draft: Draft; update: Update; currency: string | null }) {
    const t = useTranslations("Admin.orders.documents")

    return (
        <>
            {/* Received from the shipper, paid to the carrier; neutral until a party is picked */}
            <AmountField
                label={t(draft.party === "shipper" ? "form.amountReceived" : draft.party === "carrier" ? "form.amount" : "form.amountNeutral")}
                value={draft.total}
                currency={currency ?? "—"}
                onChange={(total) => update({ total })}
            />

            {draft.party && currency === null && (
                <p className="text-xs text-destructive">
                    {t("form.currencyMissing", { party: t(`parties.${draft.party}`) })}
                </p>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t("form.paidAt")}>
                    {(id) => (
                        <Input
                            id={id}
                            type="date"
                            value={draft.paidAt}
                            max={todayISO()}
                            onChange={(event) => update({ paidAt: event.target.value })}
                        />
                    )}
                </Field>
                <Field label={t("form.reference")}>
                    {(id) => (
                        <Input
                            id={id}
                            value={draft.reason}
                            maxLength={1000}
                            onChange={(event) => update({ reason: event.target.value })}
                            placeholder={t("form.referencePlaceholder")}
                        />
                    )}
                </Field>
            </div>
        </>
    )
}

/**
 * The order's document library: everything attached (PODs, invoices,
 * notes, proofs of payment, evidence) plus the add-document form.
 * Debit/credit notes carry a party and a VAT-inclusive total and shift the
 * order's effective totals server-side; proofs of payment carry the amount
 * paid and the payment date and drive the party's paid columns; voiding
 * (soft delete) reverts either.
 */
export function DocumentsCard({
    orderId,
    documents,
    canDelete,
    canCreateNote,
    canRecordPayment,
    canVoidPayment,
    orderStatus,
    shipperCurrency,
    carrierCurrency,
    invoiceDefaults,
    noteDefaults,
    preset,
}: {
    orderId: string
    documents: OrderDocument[]
    canDelete: boolean
    canCreateNote: boolean
    canRecordPayment: boolean
    canVoidPayment: boolean
    orderStatus: Order["status"]
    shipperCurrency: (typeof CURRENCY)[number] | null
    carrierCurrency: (typeof CURRENCY)[number] | null
    invoiceDefaults: InvoiceDefaults
    noteDefaults: NoteDefaults
    preset?: DocumentPreset | null
}) {
    const t = useTranslations("Admin.orders.documents")
    const f = useFormatter()

    const [adding, setAdding] = useState(false)
    const [draft, setDraft] = useState<Draft>(emptyDraft)
    const [submitting, setSubmitting] = useState(false)
    // Confirmation prompts (overpayment / replacing manual values) that must
    // be acknowledged before a proof of payment is uploaded
    const [confirming, setConfirming] = useState<string[] | null>(null)
    const fileRef = useRef<HTMLInputElement>(null)
    const cardRef = useRef<HTMLDivElement>(null)

    const trpc = useTRPC()
    const queryClient = useQueryClient()
    const { edgestore } = useEdgeStore()

    const { mutateAsync: createDocument } = useMutation(trpc.documents.create.mutationOptions())
    const { mutateAsync: voidDocument } = useMutation(trpc.documents.softDelete.mutationOptions())

    const update: Update = (patch) => setDraft((prev) => ({ ...prev, ...patch }))

    const { type, party, file } = draft
    const isNote = type !== INVOICE_OPTION && NOTE_TYPES.includes(type)
    const isPop = isProofOfPayment(type)
    const isInvoice = type === INVOICE_OPTION
    // The stored type — an invoice only has one once its party is picked
    const resolvedType = storedType(type, party)
    const invoiceParty = isInvoice ? party ?? null : null

    // Seed the invoice fields from the order the moment an invoice party is
    // chosen (render-time state adjustment, once per party pick)
    if (invoiceParty !== (draft.invoiceSeed?.party ?? null)) {
        setDraft(seedInvoice(draft, invoiceParty, invoiceDefaults))
    }

    // Proofs need the leg's paid state to warn before uploading; only fetched
    // while the form is actually recording one
    const summary = useQuery(
        trpc.documents.paymentSummary.queryOptions({ orderId }, { enabled: adding && isPop }),
    )

    // Proofs of payment are hidden until the order is booked (payment status
    // is not-applicable before) and from roles that cannot record them
    const popAllowed = canRecordPayment && orderStatus !== "prospect"
    const typeOptions = FORM_TYPES.filter(
        (option) =>
            option !== "transport-order" &&
            (canCreateNote || option === INVOICE_OPTION || !NOTE_TYPES.includes(option)) &&
            (popAllowed || !isProofOfPayment(option)),
    )

    // A note or a proof settles against one leg of the order, so it is
    // denominated in that leg's currency — the server rejects any other,
    // because the totals are summed per party without a currency dimension.
    // Neither falls back to a default: the first money document locks the
    // leg's currency, and a null one would be frozen forever. The server
    // rejects it, the UI blocks Save.
    const legCurrency: (typeof CURRENCY)[number] | null =
        party === "carrier" ? carrierCurrency : party === "shipper" ? shipperCurrency : null

    const amount = Number(draft.total)
    const isDemurrage = isNote && draft.reasonCode === DEMURRAGE
    const isDamage = isNote && draft.reasonCode === DAMAGE
    const noteDetails = isDemurrage
        ? { stage: draft.demurrageStage, days: draft.demurrageDays === "" ? undefined : Number(draft.demurrageDays) }
        : isDamage
            ? {
                ...(draft.damageTouched.percent && draft.damagedPercent !== "" && { damagedPercent: Number(draft.damagedPercent) }),
                ...(draft.damageTouched.claimed && { claimed: draft.claimed }),
            }
            : undefined
    // A note needs its party (with a currency), amount and structured
    // reason; the description only when the reason cannot stand alone;
    // demurrage its stage and days; damage a share within 0–100
    const noteReady =
        Boolean(party) && legCurrency !== null && draft.total !== "" && amount > 0 && draft.reasonCode !== undefined &&
        (!descriptionRequired(draft.reasonCode) || draft.reason.trim().length > 0) &&
        (!isDemurrage || (demurrageFieldsComplete(noteDetails) && Number(draft.demurrageDays) <= MAX_DEMURRAGE_DAYS)) &&
        (!isDamage || draft.damagedPercent === "" || Number(draft.damagedPercent) <= MAX_DAMAGED_PERCENT)
    // `max` on the date input enforces nothing without a <form>, so the
    // future-date guard is mirrored here (server is the precise one)
    const popReady =
        Boolean(party) && amount > 0 && legCurrency !== null &&
        draft.paidAt !== "" && draft.paidAt <= todayISO() && summary.isSuccess
    // An invoice needs its party (which is what picks the stored type)
    const ready = file !== null && resolvedType !== null && (!isNote || noteReady) && (!isPop || popReady)

    // "Record payment" from the payments card: open the form on the proof
    // type for that party. Applied during render (React's "adjust state on
    // prop change" pattern) so it never cascades from an effect; each nonce
    // is applied exactly once
    const [appliedNonce, setAppliedNonce] = useState<number | null>(null)
    if (preset && preset.nonce !== appliedNonce) {
        setAppliedNonce(preset.nonce)
        setAdding(true)
        setDraft({ ...emptyDraft(), type: formType(preset.type), party: preset.party ?? invoicePartyOf(preset.type) ?? undefined })
    }

    // ...and bring the card into view once that render has committed
    useEffect(() => {
        if (!preset) return
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, [preset])

    function invalidate() {
        queryClient.invalidateQueries(trpc.order.get.queryFilter({ orderId }))
        queryClient.invalidateQueries(trpc.orders.list.queryFilter())
        queryClient.invalidateQueries(trpc.documents.paymentSummary.queryFilter({ orderId }))
        queryClient.invalidateQueries(trpc.order.transitionOptions.queryFilter({ orderId }))
    }

    function resetForm() {
        setAdding(false)
        setDraft(emptyDraft())
    }

    /** The mutation's warning, if any, as a toast — the document itself is saved either way */
    function toastWarning(warning: "SHEET_FAILED" | "RECOMPUTE_PENDING" | undefined, kind: "note" | "payment" | "invoice") {
        if (warning === "RECOMPUTE_PENDING") {
            toast(t("recomputePending"))
        } else if (warning === "SHEET_FAILED") {
            toast(t(kind === "payment" ? "paymentSheetWarning" : kind === "invoice" ? "invoiceSheetWarning" : "sheetWarning"))
        }
    }

    /**
     * Save entry point: a proof of payment may need an explicit
     * acknowledgement first (overpaying the leg, or replacing hand-typed
     * paid values for good); everything else uploads straight away.
     */
    function onSave() {
        if (!ready || submitting) return

        if (isPop && party && summary.data && legCurrency) {
            const leg = summary.data[party]
            const messages: string[] = []

            // The first proof replaces whatever was typed by hand — an
            // amount, or just a status/date (mirrors the server's snapshot)
            const typedByHand = leg.manualPaidAmount > 0
                || leg.paymentStatus === "partially" || leg.paymentStatus === "completed"
                || leg.fullPaymentDate !== null
            if (!leg.governed && typedByHand) {
                messages.push(leg.manualPaidAmount > 0
                    ? t("confirm.replaceManual", {
                        party: t(`parties.${party}`),
                        amount: f.number(leg.manualPaidAmount, { maximumFractionDigits: 2 }),
                        currency: legCurrency,
                    })
                    : t("confirm.replaceManualStatus", { party: t(`parties.${party}`) }))
            }
            if (leg.effectiveTotal !== null && leg.effectiveTotal > 0 && cents(leg.paidTotal + amount) > cents(leg.effectiveTotal)) {
                // Read from Appload's side: received from the shipper, paid to the carrier
                messages.push(t(party === "shipper" ? "confirm.overpaidReceived" : "confirm.overpaid", {
                    paid: f.number(leg.paidTotal + amount, { maximumFractionDigits: 2 }),
                    total: f.number(leg.effectiveTotal, { maximumFractionDigits: 2 }),
                    currency: legCurrency,
                }))
            }

            if (messages.length > 0) {
                setConfirming(messages)
                return
            }
        }

        void submit()
    }

    async function submit() {
        if (!file || submitting || resolvedType === null) return

        setSubmitting(true)
        try {
            const { url } = await edgestore.apploadFiles.upload({
                file,
                input: { path: orderDocumentPath(orderId, resolvedType) },
            })

            if (!url) {
                toast(t("uploadError"))
                return
            }

            const seed = draft.invoiceSeed
            const invoiceNumber = draft.invoiceNumber.trim()

            const result = await createDocument({
                orderId,
                type: resolvedType,
                party: isNote || isPop || isInvoice ? party : undefined,
                url,
                title: file.name,
                size: file.size,
                mimeType: file.type,
                ...(isNote && {
                    total: amount,
                    currency: legCurrency ?? undefined,
                    reason: draft.reason.trim() || undefined,
                    reasonCode: draft.reasonCode,
                    details: noteDetails,
                }),
                ...(isPop && {
                    total: amount,
                    currency: legCurrency ?? undefined,
                    paidAt: isoDayToUtcMidnight(draft.paidAt) ?? undefined,
                    reason: draft.reason.trim() || undefined,
                }),
                // The order's invoice number/date ride along with an invoice
                // upload — only when the operator changed them, so an upload
                // alone never rewrites the order
                ...(invoiceParty && seed && {
                    ...(invoiceNumber !== seed.number && { invoiceNumber }),
                    ...(draft.invoiceDate !== seed.date && draft.invoiceDate !== "" && {
                        invoiceDate: isoDayToUtcMidnight(draft.invoiceDate) ?? undefined,
                    }),
                }),
            })

            toastWarning(result.warning, isPop ? "payment" : invoiceParty ? "invoice" : "note")

            invalidate()
            resetForm()
        } catch (error) {
            console.error(error)
            const code = domainErrorCode(error, DOCUMENT_ERROR_CODES, "UNKNOWN")
            toast(t(`errors.${code}`))
            invalidate()
        } finally {
            setSubmitting(false)
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
        <Card ref={cardRef}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">{t("title")}</CardTitle>
                <Button size="sm" variant="outline" onClick={() => setAdding((prev) => !prev)}>
                    <IconFilePlus />
                    {t("add")}
                </Button>
            </CardHeader>

            <CardContent className="flex flex-col gap-3">
                {adding && (
                    <div className="flex flex-col gap-3 rounded-xl border p-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field label={t("form.type")}>
                                {(id) => (
                                    <Select value={type} onValueChange={(value) => update({ type: value as FormType })}>
                                        <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
                                        <SelectContent position="popper">
                                            {typeOptions.map((option) => (
                                                <SelectItem key={option} value={option}>{t(`types.${option}`)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </Field>

                            {(isNote || isPop || isInvoice) && (
                                <Field label={t("form.party")}>
                                    {(id) => (
                                        <Select value={party} onValueChange={(value) => update({ party: value as DocumentParty })}>
                                            <SelectTrigger id={id} className="w-full">
                                                <SelectValue placeholder={t("form.partyPlaceholder")} />
                                            </SelectTrigger>
                                            <SelectContent position="popper">
                                                {DOCUMENT_PARTY.map((option) => (
                                                    <SelectItem key={option} value={option}>{t(`parties.${option}`)}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                </Field>
                            )}
                        </div>

                        {isNote && <NoteFields draft={draft} update={update} currency={legCurrency} noteDefaults={noteDefaults} />}
                        {invoiceParty && <InvoiceFields draft={draft} update={update} party={invoiceParty} />}
                        {isPop && <PopFields draft={draft} update={update} currency={legCurrency} />}

                        <div className="flex flex-wrap items-center gap-2">
                            <input
                                ref={fileRef}
                                type="file"
                                className="hidden"
                                accept={ACCEPTED_FILES.join(",")}
                                onChange={(event) => {
                                    const picked = event.target.files?.[0] ?? null
                                    if (picked && !ACCEPTED_FILES.includes(picked.type)) {
                                        toast(t("formatError"))
                                        return
                                    }
                                    update({ file: picked })
                                }}
                            />
                            <Button type="button" size="sm" variant="outline" disabled={submitting} onClick={() => fileRef.current?.click()}>
                                <IconUpload />
                                {file ? t("form.replaceFile") : t("form.pickFile")}
                            </Button>
                            {file && <span className="min-w-0 truncate text-xs text-muted-foreground">{file.name}</span>}

                            <div className="ml-auto flex gap-2">
                                <Button type="button" size="sm" variant="ghost" disabled={submitting} onClick={resetForm}>
                                    <IconX />
                                    {t("form.cancel")}
                                </Button>
                                <Button type="button" size="sm" disabled={!ready || submitting} onClick={onSave}>
                                    {submitting && <Spinner />}
                                    {t("form.save")}
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

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
            </CardContent>

            <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("confirm.title")}</AlertDialogTitle>
                        <AlertDialogDescription className="flex flex-col gap-2">
                            {confirming?.map((message, index) => (
                                <span key={index}>{message}</span>
                            ))}
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    <AlertDialogFooter>
                        <AlertDialogCancel>{t("confirm.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                setConfirming(null)
                                void submit()
                            }}
                        >
                            {t("confirm.continue")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    )
}
