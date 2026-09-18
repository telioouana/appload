import { fillTemplate, type TemplateValues } from "@workspace/domain/pdf/fill-template"

import type { MovementDetail } from "@/frontend/pages/movements/types"

/**
 * The confirmation a company sends the partner it placed a load with.
 *
 * It is Appload's own transport-order template, filled here in the browser
 * with what the load already says, so the paper the partner receives reads
 * like the one it would have received from Appload. The company sending it
 * takes the shipper's side of the form: on this load it is the one buying
 * the transport, whether it is a transporter subcontracting or a shipper
 * placing its own freight.
 */

const TEMPLATE_PATH = "/templates/carrier-template-pt.pdf"

/** Drops the characters a filesystem refuses and collapses the leftover spacing. */
const safeFileName = (value: string) => value.trim().replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ")

/** What the confirmation is attached and stored as; the partner's name tells two apart. */
export function confirmationFileName(load: MovementDetail): string {
    const partner = safeFileName(load.carrier?.name ?? "")

    return partner ? `Confirmação ${load.ref} — ${partner}.pdf` : `Confirmação ${load.ref}.pdf`
}

const templateValues = (load: MovementDetail, companyName: string): TemplateValues => ({
    reference: load.ref,
    loadingAddress: { address: load.origin.address },
    offloadingAddress: { address: load.destination.address },
    description: load.cargoDescription ?? "",
    weight: load.weight ?? 0,
    weightUnit: load.weightUnit ?? "ton",
    // The form has one loading date and always prints it; a load filed
    // without one falls back to the day it was filed
    expectedLoadingDate: load.expectedLoadingDate ?? load.createdAt,
    shipperName: companyName,
    shipperTotal: load.money.receivable?.total ?? 0,
    shipperCurrency: load.money.receivable?.currency ?? "MZN",
    carrierName: load.carrier?.name ?? "",
    carrierTotal: load.money.payable?.total ?? 0,
    carrierCurrency: load.money.payable?.currency ?? "MZN",
    truckPlate: load.truckPlate ?? "",
    // Left undefined when there is no trailer, which is what the form's
    // "Trelha: NÃO" then says
    trailerPlate: load.trailerPlate ?? undefined,
    driverName: load.driverName ?? "",
    driverContact: load.driverPhone ?? "",
})

/** Fills the carrier template with the load and hands back the PDF. */
export async function buildConfirmationPdf(load: MovementDetail, companyName: string): Promise<Blob> {
    const bytes = await fetch(TEMPLATE_PATH).then((response) => response.arrayBuffer())
    const filled = await fillTemplate(bytes, "carrier", templateValues(load, companyName))

    return new Blob([filled as unknown as BlobPart], { type: "application/pdf" })
}
