import { downloadCsv, stamp } from "@workspace/ui/lib/csv"

import { MOVEMENT_COST_KIND } from "@/backend/schemas/movement"

/** What a CSV row is cut from: the shape `movements.export` and `movements.costReport` return. */
export type ExportedLoad = {
    ref: string
    apploadOrderId: string | null
    status: string
    origin: { address: string }
    destination: { address: string }
    client: { name: string | null } | null
    carrier: { name: string | null } | null
    owner: { name: string | null } | null
    driverName: string | null
    truckPlate: string | null
    expectedLoadingDate: Date | null
    deliveredAt: Date | null
    receivable: { total: number; currency: string } | null
    payable: { total: number; currency: string } | null
    costs: Array<{ kind: string; currency: string; amount: number }>
    costTotals: Array<{ currency: string; total: number }>
    margin: { amount: number; currency: string } | null
}

const date = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "")

/** One cell holding sums in however many currencies, "1234.56 MZN" apiece. */
const money = (lines: Array<{ currency: string; amount?: number; total?: number }>) =>
    lines.map((line) => `${line.amount ?? line.total} ${line.currency}`).join(" · ")

/** The loads file both the list and the report download: one fixed column per cost kind. */
export function downloadLoadsCsv(prefix: string, items: ExportedLoad[]) {
    downloadCsv(
        `${prefix}-${stamp()}.csv`,
        [
            "Ref", "Order", "Status", "From", "To", "Client", "Carrier", "Owner", "Driver", "Truck",
            "Expected loading", "Delivered", "Receivable", "Payable",
            ...MOVEMENT_COST_KIND.map((kind) => `Cost: ${kind}`),
            "Costs total", "Margin",
        ],
        items.map((row) => [
            row.ref, row.apploadOrderId ?? "", row.status,
            row.origin.address, row.destination.address,
            row.client?.name ?? "", row.carrier?.name ?? "", row.owner?.name ?? "",
            row.driverName ?? "", row.truckPlate ?? "",
            date(row.expectedLoadingDate), date(row.deliveredAt),
            row.receivable ? `${row.receivable.total} ${row.receivable.currency}` : "",
            row.payable ? `${row.payable.total} ${row.payable.currency}` : "",
            ...MOVEMENT_COST_KIND.map((kind) => money(row.costs.filter((line) => line.kind === kind))),
            money(row.costTotals),
            row.margin ? `${row.margin.amount} ${row.margin.currency}` : "",
        ]),
    )
}
