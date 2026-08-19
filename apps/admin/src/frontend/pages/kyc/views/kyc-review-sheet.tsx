"use client"

import { useState } from "react"
import { IconX } from "@tabler/icons-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { authClient } from "@workspace/auth/client"
import { useTranslations } from "@workspace/i18n"
import type { KycDocumentType } from "@workspace/db/types"
import type { KycDocument } from "@workspace/db/kyc-documents"
import { isAuthorized, STAFF_ROLES, type StaffRole } from "@workspace/auth/user-permissions"

import { Button } from "@workspace/ui/components/button"
import { Alert } from "@workspace/ui/components/alert"
import { Spinner } from "@workspace/ui/components/spinner"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"

import { useTRPC } from "@/backend/api/client"
import { domainErrorCode } from "@/lib/trpc-error"
import { REQUIRED_DOCS, requirementFor } from "@/lib/kyc/requirements"
import { useKycReview } from "@/frontend/pages/kyc/hooks/use-kyc-review"
import { DocumentDecision } from "@/frontend/pages/kyc/sections/document-decision"
import { DocumentSlot } from "@/frontend/pages/kyc/sections/document-slot"
import { DocumentUpload } from "@/frontend/pages/kyc/sections/document-upload"

// Domain codes the review mutation can raise, mapped to message keys so the
// reviewer never sees a raw SCREAMING_SNAKE code
const REVIEW_ERROR_CODES = [
    "EXPIRY_REQUIRED",
    "REASON_REQUIRED",
    "OWNER_NUIT_REQUIRED",
    "CARRIER_UNKNOWN",
    "ALREADY_REVIEWED",
    "NOT_ALLOWED",
    "INVALID_STATE",
    "NOT_FOUND",
    "UNKNOWN",
] as const

type ReviewErrorCode = (typeof REVIEW_ERROR_CODES)[number]

const isStaffRole = (value: string | null | undefined): value is StaffRole =>
    value !== null && value !== undefined && value in STAFF_ROLES

/**
 * The review surface: the subject's required-document checklist, the pages
 * of whichever document is open, and the decision form.
 *
 * One instance per list page, driven by the row that was clicked.
 */
export function KycReviewSheet() {
    const t = useTranslations("Admin.partners.review")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const { isOpen, subject, onClose } = useKycReview()
    const [openSlot, setOpenSlot] = useState<string | null>(null)

    const { data: session } = authClient.useSession()
    // A role the app does not know about is treated as the least privileged
    // one, never trusted into the review actions
    const role: StaffRole = isStaffRole(session?.user.role) ? session.user.role : "user"
    const canReview = isAuthorized(role, "kyc", ["review"])
    const canUpload = isAuthorized(role, "kyc", ["upload"])

    const query = useQuery({
        ...trpc.kyc.documents.queryOptions(
            subject
                ? { subjectType: subject.subjectType, subjectId: subject.subjectId }
                : { subjectType: "organization", subjectId: "" },
        ),
        enabled: isOpen && Boolean(subject),
    })

    const invalidate = async () => {
        // The row's badges and progress derive from these documents, so the
        // list has to refetch alongside the sheet
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: trpc.kyc.pathKey() }),
            queryClient.invalidateQueries({ queryKey: trpc.partners.pathKey() }),
        ])
    }

    const review = useMutation(trpc.kyc.review.mutationOptions({
        onSuccess: async () => {
            setOpenSlot(null)
            await invalidate()
        },
    }))

    const kind = query.data?.subject.kind
    const documents = query.data?.documents ?? []
    const byType = new Map<KycDocumentType, KycDocument>(documents.map((doc) => [doc.type, doc]))

    const close = () => {
        setOpenSlot(null)
        review.reset()
        onClose()
    }

    const reviewError = review.error
        ? domainErrorCode<ReviewErrorCode>(review.error, REVIEW_ERROR_CODES, "UNKNOWN")
        : null

    return (
        <Sheet open={isOpen} onOpenChange={(next) => { if (!next) close() }}>
            <SheetContent
                side="right"
                showCloseButton={false}
                className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-none md:data-[side=right]:w-3/5 2xl:data-[side=right]:w-1/2"
            >
                <SheetHeader>
                    <SheetTitle>{subject?.title ?? t("title")}</SheetTitle>
                    <SheetDescription>{subject?.subtitle ?? t("description")}</SheetDescription>

                    <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={close}
                        className="absolute top-4 right-4 bg-secondary"
                    >
                        <IconX />
                        <span className="sr-only">{t("close")}</span>
                    </Button>
                </SheetHeader>

                <div className="flex flex-col gap-4 p-4">
                    {!canReview && <Alert variant="destructive">{t("not-allowed")}</Alert>}

                    {query.isPending && (
                        <div className="flex justify-center py-10">
                            <Spinner className="text-primary" />
                        </div>
                    )}

                    {query.isError && <Alert variant="destructive">{t("errors.LOAD_FAILED")}</Alert>}

                    {kind && subject && (
                        <>
                            <h3 className="text-sm font-medium">{t("checklist")}</h3>

                            <div className="flex flex-col gap-3">
                                {REQUIRED_DOCS[kind].map((requirement) => {
                                    // A slot may accept more than one document type
                                    // (a driver proves identity with either a licence
                                    // or an ID card). Every type actually present is
                                    // rendered — showing only the first would hide a
                                    // second submission from review entirely.
                                    const present = requirement.anyOf.filter((candidate) => byType.has(candidate))
                                    const slotTypes = present.length > 0 ? present : [requirement.anyOf[0]!]
                                    const satisfied = present.some(
                                        (candidate) => byType.get(candidate)?.status === "approved",
                                    )

                                    return slotTypes.map((type) => {
                                        const document = byType.get(type)
                                        const isOpenSlot = openSlot === type

                                        return (
                                            <div key={type} className="flex flex-col gap-3">
                                                <DocumentSlot
                                                    type={type}
                                                    document={document}
                                                    expanded={isOpenSlot}
                                                    onToggle={() => setOpenSlot(isOpenSlot ? null : type)}
                                                />

                                                {isOpenSlot && document && (
                                                    <DocumentDecision
                                                        document={document}
                                                        needsExpiry={requirementFor(kind, type)?.expires ?? false}
                                                        carrierNuit={query.data?.carrierNuit}
                                                        canReview={canReview}
                                                        isPending={review.isPending}
                                                        error={reviewError ? t(`errors.${reviewError}`) : null}
                                                        onSubmit={(payload) => review.mutate(payload)}
                                                    />
                                                )}

                                                {/* Upload is offered where the slot is
                                                    empty, and as a resubmission when the
                                                    document was turned down */}
                                                {canUpload && (!document || document.status === "rejected") && !satisfied && (
                                                    <DocumentUpload
                                                        subjectType={subject.subjectType}
                                                        subjectId={subject.subjectId}
                                                        type={type}
                                                        needsExpiry={requirementFor(kind, type)?.expires ?? false}
                                                        replacing={document?.id}
                                                        onUploaded={invalidate}
                                                    />
                                                )}
                                            </div>
                                        )
                                    })
                                })}
                            </div>
                        </>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    )
}
