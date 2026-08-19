"use client"

import { IconChevronDown, IconFileText } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"
import type { KycDocument } from "@workspace/db/kyc-documents"
import type { KycDocumentType, KycPage } from "@workspace/db/types"

import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent } from "@workspace/ui/components/card"

import { cn } from "@workspace/ui/lib/utils"

const STATUS_VARS: Record<string, string> = {
    approved: "verified",
    rejected: "rejected",
    pending: "pending-review",
}

/**
 * One row of the checklist: what the slot needs, whether it is filled, and
 * the pages once opened.
 */
export function DocumentSlot({
    type,
    document,
    expanded,
    onToggle,
}: {
    type: KycDocumentType
    document: KycDocument | undefined
    expanded: boolean
    onToggle: () => void
}) {
    const t = useTranslations("Admin.partners")
    const f = useFormatter()

    const statusKey = document ? STATUS_VARS[document.status] ?? "draft" : "draft"

    return (
        <Card className={cn("transition-colors", expanded && "border-primary/40")}>
            <CardContent className="flex flex-col gap-3 p-3">
                <button
                    type="button"
                    onClick={onToggle}
                    disabled={!document}
                    className="flex min-w-0 items-center gap-3 text-left disabled:cursor-not-allowed"
                >
                    <IconFileText className="text-muted-foreground size-5 shrink-0" stroke={1.5} />

                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium">{t(`documents.${type}`)}</span>
                        <span className="text-muted-foreground truncate text-xs">
                            {document
                                ? t("review.uploaded", { date: f.dateTime(document.createdAt, { dateStyle: "medium" }) })
                                : t("review.missing")}
                        </span>
                    </div>

                    <Badge
                        variant="secondary"
                        className="shrink-0 rounded-full border-none"
                        style={{
                            color: `var(--status-${statusKey}-text)`,
                            backgroundColor: `var(--status-${statusKey}-bg)`,
                        }}
                    >
                        {document ? t(`review.${document.status}`) : t("review.missing")}
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
                            <p className="text-[var(--status-rejected-text)] text-sm">
                                {document.rejectionReason}
                            </p>
                        )}

                        {(document.pages as KycPage[]).map((page, index) => (
                            <DocumentPreview key={page.url} page={page} index={index} />
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

/**
 * The page itself. PDFs render in an <object> and images inline; anything
 * else falls back to a link, because a reviewer who cannot see the document
 * must not be able to approve it by accident.
 */
function DocumentPreview({ page, index }: { page: KycPage; index: number }) {
    const t = useTranslations("Admin.partners.review")
    const isPdf = page.mimeType === "application/pdf" || page.url.toLowerCase().endsWith(".pdf")
    const isImage = page.mimeType?.startsWith("image/") ?? /\.(png|jpe?g)$/i.test(page.url)

    return (
        <div className="flex flex-col gap-1">
            <div className="bg-muted overflow-hidden rounded-lg">
                {isPdf ? (
                    <object data={page.url} type="application/pdf" className="h-96 w-full">
                        <Fallback url={page.url} label={t("open-file")} note={t("no-preview")} />
                    </object>
                ) : isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={page.url} alt={`${t("preview")} ${index + 1}`} className="max-h-96 w-full object-contain" />
                ) : (
                    <Fallback url={page.url} label={t("open-file")} note={t("no-preview")} />
                )}
            </div>
        </div>
    )
}

function Fallback({ url, label, note }: { url: string; label: string; note: string }) {
    return (
        <div className="flex flex-col items-center gap-2 p-6 text-sm">
            <span className="text-muted-foreground">{note}</span>
            <a href={url} target="_blank" rel="noreferrer" className="text-primary underline">
                {label}
            </a>
        </div>
    )
}
