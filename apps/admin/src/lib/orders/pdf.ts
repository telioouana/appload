import type { Order } from "@workspace/db/orders";
import type { LoadingBay } from "@workspace/db/types";

import { fillTemplate, type TemplateKind, type TemplateValues } from "@workspace/domain/pdf/fill-template";

export type { TemplateKind, TemplateValues };

// The AcroForm helpers are the same wherever a template is filled; the KPI
// reports fill their own through them
export { findField, setDropdown, setText } from "@workspace/domain/pdf/fill-template";

/**
 * Order columns whose change makes the booking-confirmation PDFs stale.
 * `loadingBay` is fleet-derived, so plate changes cover it.
 */
export const PDF_RELEVANT_FIELDS = [
    "loadingAddress",
    "offloadingAddress",
    "description",
    "weight",
    "weightUnit",
    "expectedLoadingDate",
    "shipperTotal",
    "shipperCurrency",
    "carrierTotal",
    "carrierCurrency",
    "carrierName",
    "truckPlate",
    "trailerPlate",
    "driverName",
    "driverPhoneNumber",
    "insuranceValue",
] as const;

export function orderToTemplateValues(row: Order, loadingBay: LoadingBay["type"] | null): TemplateValues {
    return {
        reference: row.orderId,
        loadingAddress: row.loadingAddress,
        offloadingAddress: row.offloadingAddress,
        description: row.description,
        weight: Number(row.weight),
        weightUnit: row.weightUnit,
        expectedLoadingDate: row.expectedLoadingDate,
        shipperName: row.shipperName,
        shipperTotal: row.shipperTotal !== null ? Number(row.shipperTotal) : 0,
        shipperCurrency: row.shipperCurrency ?? "MZN",
        carrierName: row.carrierName ?? undefined,
        carrierTotal: row.carrierTotal !== null ? Number(row.carrierTotal) : undefined,
        carrierCurrency: row.carrierCurrency ?? undefined,
        truckPlate: row.truckPlate ?? undefined,
        trailerPlate: row.trailerPlate ?? undefined,
        driverName: row.driverName ?? undefined,
        driverContact: row.driverPhoneNumber ?? undefined,
        loadingBay: loadingBay ?? undefined,
        insuranceValue: row.insuranceValue !== null ? Number(row.insuranceValue) : undefined,
    };
}

const TEMPLATE_PATHS: Record<TemplateKind, string> = {
    shipper: "/templates/shipper-template-pt.pdf",
    carrier: "/templates/carrier-template-pt.pdf",
};

/** Drops the characters a filesystem refuses and collapses the leftover spacing. */
export function safeFileName(text: string): string {
    return text.trim().replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ");
}

/**
 * Canonical download/attachment name: the party's own name is part of the
 * filename so recipients can tell the documents apart.
 */
export function pdfFileName(kind: TemplateKind, orderId: string, partyName?: string | null): string {
    const party = safeFileName(partyName ?? "");
    return party ? `${orderId} - ${party} - ${kind}.pdf` : `${orderId} - ${kind}.pdf`;
}

/**
 * Fetches one of the booking-confirmation templates and fills its AcroForm
 * fields with the order data. Runs in the browser; templates live in public/.
 */
export async function fillOrderTemplate(
    kind: TemplateKind,
    orderId: string,
    values: TemplateValues,
): Promise<Blob> {
    const bytes = await fetch(TEMPLATE_PATHS[kind]).then((response) => response.arrayBuffer());
    // The id the caller opened the order by is the one the paper must carry
    const filled = await fillTemplate(bytes, kind, { ...values, reference: orderId });

    return new Blob([filled as unknown as BlobPart], { type: "application/pdf" });
}
