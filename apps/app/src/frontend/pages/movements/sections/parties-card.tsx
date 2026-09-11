"use client"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { DetailRow, SectionCard } from "@workspace/ui/customs/detail/section-card"
import { Dash, PlateChip } from "@workspace/ui/customs/list/table-cells"

import type { MovementDetail, OrgType } from "@/frontend/pages/movements/types"

/**
 * Who is on the load, as far as the reader may know. The owner sees its own
 * client and the partner it placed the load with; a partner that was
 * offered the load, and a client it is moved for, see only the company that
 * owns it — who that company's own client or subcontractor is stays its
 * business. The driver and the plate are everybody's: they are what a
 * client waiting at the gate asks for.
 */
export function PartiesCard({ load, orgType }: { load: MovementDetail; orgType: OrgType }) {
    const t = useTranslations("App.loads.detail")
    const f = useFormatter()

    const owner = load.role === "owner"
    const partner = load.execution === "partner"
    const date = (value: Date | null) => value ? f.dateTime(value, { dateStyle: "medium", timeStyle: "short" }) : <Dash />

    return (
        <SectionCard title={t("parties")}>
            <dl className="flex flex-col gap-2">
                {!owner && (
                    <DetailRow label={t(load.role === "executor" ? "fields.offered-by" : "fields.moved-by")}>
                        {load.owner?.name ?? <Dash />}
                    </DetailRow>
                )}

                {/* A shipper's own loads are for itself: it has no client */}
                {owner && orgType === "carrier" && (
                    <DetailRow label={t("fields.client")}>
                        {load.client?.name ?? <span className="text-muted-foreground">{t("values.own-account")}</span>}
                    </DetailRow>
                )}

                {load.clientReference && (
                    <DetailRow label={t("fields.client-reference")}>{load.clientReference}</DetailRow>
                )}

                {owner && load.hasParent && (
                    <p className="text-muted-foreground text-xs">{t("values.has-parent")}</p>
                )}

                {owner && partner && (
                    <>
                        <DetailRow label={t("fields.partner")}>
                            {load.carrier?.name ?? <span className="text-muted-foreground">{t("values.no-partner")}</span>}
                        </DetailRow>

                        {load.offeredAt && <DetailRow label={t("fields.offered-at")}>{date(load.offeredAt)}</DetailRow>}
                        {load.respondedAt && <DetailRow label={t("fields.responded-at")}>{date(load.respondedAt)}</DetailRow>}

                        {load.isLinked && <p className="text-muted-foreground text-xs">{t("values.linked")}</p>}
                    </>
                )}

                {load.role === "executor" && load.offeredAt && (
                    <DetailRow label={t("fields.offered-at")}>{date(load.offeredAt)}</DetailRow>
                )}

                {load.responseNote && (
                    <p className="bg-muted/40 rounded-xl px-4 py-3 text-[13px] whitespace-pre-line">
                        <span className="text-muted-foreground block text-xs">{t("fields.response-note")}</span>
                        {load.responseNote}
                    </p>
                )}
            </dl>

            <dl className="flex flex-col gap-2 border-t pt-3.5">
                <DetailRow label={t("fields.driver")}>{load.driverName ?? <Dash />}</DetailRow>
                {owner && load.driverPhone && (
                    <DetailRow label={t("fields.phone")}>
                        <span className="font-mono text-xs">{load.driverPhone}</span>
                    </DetailRow>
                )}
                <DetailRow label={t("fields.plate")}>
                    {load.truckPlate ? <PlateChip plate={load.truckPlate} /> : <Dash />}
                </DetailRow>
            </dl>
        </SectionCard>
    )
}
