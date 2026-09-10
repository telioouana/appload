"use client"

import { useState } from "react"
import { IconExternalLink, IconFilePlus } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

import { SectionCard } from "@/frontend/pages/orders/components/section-card"
import { AddDocumentDialog } from "@/frontend/pages/orders/sections/add-document-dialog"
import type { OrderDetail, OrgType } from "@/frontend/pages/orders/types"
import { PARTNER_DOCUMENT_TYPES, type PartnerDocumentType } from "@/backend/schemas/dispatch"

/** The client only ever files evidence; the POD is the carrier's to produce. */
const SHIPPER_TYPES: readonly PartnerDocumentType[] = ["evidence"]

/**
 * What is attached to this order: the proof of delivery, whatever else the
 * carrier documented on the way, and the transport order Appload issued.
 * Nothing here can be removed from the portal — a filed proof is a record.
 */
export function DocumentsCard({ order, orgType }: { order: OrderDetail; orgType: OrgType }) {
    const t = useTranslations("App.orders.documents")
    const f = useFormatter()

    const [addOpen, setAddOpen] = useState(false)

    // A carrier files against the trip it is running, a client against its
    // own order — which is exactly what `isMine` says from either side, and
    // what the procedure re-checks
    const canAdd = order.permissions.isMine
    const types = orgType === "shipper" ? SHIPPER_TYPES : PARTNER_DOCUMENT_TYPES

    return (
        <>
            <SectionCard
                title={t("title")}
                count={order.documents.length}
                actions={canAdd ? (
                    <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                        <IconFilePlus />
                        {t("add.action")}
                    </Button>
                ) : undefined}
            >
                {order.documents.length === 0 ? (
                    <p className="text-muted-foreground py-2 text-sm">{t("empty")}</p>
                ) : (
                    <ul className="flex flex-col divide-y">
                        {order.documents.map((document) => (
                            <li key={document.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <Badge variant="outline">{t(`types.${document.type}`)}</Badge>
                                        {document.uploadedByName && (
                                            <span className="text-muted-foreground text-xs">{document.uploadedByName}</span>
                                        )}
                                    </div>

                                    <span className="text-muted-foreground truncate text-xs">
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
                            </li>
                        ))}
                    </ul>
                )}
            </SectionCard>

            {canAdd && (
                <AddDocumentDialog
                    orderId={order.orderId}
                    types={types}
                    open={addOpen}
                    onOpenChange={setAddOpen}
                />
            )}
        </>
    )
}
