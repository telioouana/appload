"use client"

import { useState } from "react"
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { IconChevronDown, IconFileText } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"
import { isOrgAuthorized } from "@workspace/auth/organization-permissions"
import type { KycDocumentType, KycPage, OrderDispatchSubject } from "@workspace/db/types"

import { Badge } from "@workspace/ui/components/badge"
import { Spinner } from "@workspace/ui/components/spinner"
import { Alert } from "@workspace/ui/components/alert"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { REQUIRED_DOCS, subjectKind } from "@workspace/domain/kyc/requirements"
import { ProfileCard } from "@/frontend/pages/fleet/sections/profile-parts"
import { PaperPreview, PaperUpload } from "@/frontend/pages/fleet/sections/paper-upload"

/**
 * The papers Appload holds for one driver or vehicle, and the way to file
 * what is missing.
 *
 * One row per slot of the subject's checklist, so a carrier reads the same
 * list the reviewer does — including the slots nothing has been filed for,
 * which a list of what exists could never show. Review stays Appload's: what
 * is filed here lands `pending`.
 */
export function PapersCard({
    subjectType,
    subjectId,
    title,
    className,
}: {
    subjectType: OrderDispatchSubject
    subjectId: string
    title: string
    className?: string
}) {
    const t = useTranslations("App.fleet.papers")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const [openSlot, setOpenSlot] = useState<KycDocumentType | null>(null)

    const { data: session } = useSuspenseQuery(trpc.me.session.queryOptions())
    const canUpload = isOrgAuthorized(session.role, "kyc", ["upload"])

    const query = useQuery(trpc.kyc.documents.queryOptions({ subjectType, subjectId }))

    const invalidate = async () => {
        // The badges and the progress on both lists derive from these
        // documents, so they refetch alongside the card
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: trpc.kyc.pathKey() }),
            queryClient.invalidateQueries({ queryKey: trpc.fleet.pathKey() }),
            queryClient.invalidateQueries({ queryKey: trpc.drivers.pathKey() }),
        ])
    }

    // The checklist is rendered from the loaded set, never from the subject
    // kind alone: with nothing in hand every slot would read "Missing" and
    // offer to file over a paper that already stands
    const kind = query.data ? subjectKind(subjectType) : null
    const documents = query.data?.documents ?? []
    const byType = new Map(documents.map((doc) => [doc.type, doc]))

    return (
        <ProfileCard title={title} className={className}>
            {query.isPending && (
                <div className="flex justify-center py-6">
                    <Spinner className="text-primary" />
                </div>
            )}

            {query.isError && <Alert variant="destructive">{t("errors.LOAD_FAILED")}</Alert>}

            {kind && REQUIRED_DOCS[kind].map((requirement) => {
                // A slot may accept more than one document type (a driver
                // proves identity with either a licence or an ID card).
                // Every type actually filed is rendered; where none is, the
                // first is offered as the one to file.
                const present = requirement.anyOf.filter((candidate) => byType.has(candidate))
                const slotTypes = present.length > 0 ? present : [requirement.anyOf[0]!]
                const satisfied = present.some((candidate) => byType.get(candidate)?.status === "approved")

                return slotTypes.map((type) => {
                    const document = byType.get(type)
                    const expanded = openSlot === type

                    return (
                        <div key={type} className="flex flex-col gap-2">
                            <button
                                type="button"
                                disabled={!document}
                                onClick={() => setOpenSlot(expanded ? null : type)}
                                className="flex min-w-0 items-center gap-3 text-left disabled:cursor-default"
                            >
                                <IconFileText className="text-muted-foreground size-5 shrink-0" stroke={1.5} />

                                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <span className="truncate text-[13px] font-medium">{t(`doc-type.${type}`)}</span>
                                    <span className="text-muted-foreground truncate text-xs">
                                        <Expiry expiresAt={document?.expiresAt ?? null} filed={Boolean(document)} />
                                    </span>
                                </div>

                                <Badge
                                    variant={document?.status === "approved" ? "default" : document?.status === "rejected" ? "destructive" : "secondary"}
                                    className="shrink-0"
                                >
                                    {document ? t(`doc-status.${document.status}`) : t("missing")}
                                </Badge>

                                {document && (
                                    <IconChevronDown
                                        className={cn("size-4 shrink-0 transition-transform", expanded && "rotate-180")}
                                        stroke={1.5}
                                    />
                                )}
                            </button>

                            {expanded && document && (
                                <div className="flex flex-col gap-2">
                                    {document.rejectionReason && (
                                        <p className="text-destructive text-[13px]">{document.rejectionReason}</p>
                                    )}

                                    {(document.pages as KycPage[]).map((page, index) => (
                                        <PaperPreview key={page.url} page={page} index={index} />
                                    ))}
                                </div>
                            )}

                            {/* Filing is offered where the slot is empty, and
                                as a resubmission when the paper was turned
                                down — never over one that already stands */}
                            {canUpload && (!document || document.status === "rejected") && !satisfied && (
                                <PaperUpload
                                    subjectType={subjectType}
                                    subjectId={subjectId}
                                    type={type}
                                    onUploaded={invalidate}
                                />
                            )}
                        </div>
                    )
                })
            })}

            {kind && <p className="text-muted-foreground text-xs">{t("review-note")}</p>}
        </ProfileCard>
    )
}

function Expiry({ expiresAt, filed }: { expiresAt: string | null; filed: boolean }) {
    const t = useTranslations("App.fleet.papers")
    const f = useFormatter()

    if (!filed) return <>{t("not-filed")}</>
    if (!expiresAt) return <>{t("no-expiry")}</>

    return <>{t("expires", { date: f.dateTime(new Date(`${expiresAt}T00:00:00`), { dateStyle: "medium" }) })}</>
}
