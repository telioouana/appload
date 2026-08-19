import { PDFCheckBox, PDFDocument, PDFDropdown, PDFTextField, type PDFForm } from "pdf-lib";

import type { Order } from "@workspace/db/orders";
import { LOADING_BAY, type LoadingBay } from "@workspace/db/types";

export type TemplateKind = "shipper" | "carrier";

/**
 * The exact slice of order data the templates read. `CreateOrderForm`
 * satisfies it structurally; stored rows go through `orderToTemplateValues`.
 */
export type TemplateValues = {
    loadingAddress: { address: string };
    offloadingAddress: { address: string };
    description: string;
    weight: number;
    weightUnit: string;
    expectedLoadingDate: Date;
    shipperName: string;
    shipperTotal: number;
    shipperCurrency: string;
    carrierName?: string;
    carrierTotal?: number;
    carrierCurrency?: string;
    truckPlate?: string;
    trailerPlate?: string;
    driverName?: string;
    driverContact?: string;
    loadingBay?: (typeof LOADING_BAY)[number];
    insuranceValue?: number;
};

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

/**
 * Canonical download/attachment name: the party's own name is part of the
 * filename so recipients can tell the documents apart.
 */
export function pdfFileName(kind: TemplateKind, orderId: string, partyName?: string | null): string {
    const party = partyName?.trim().replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ");
    return party ? `${orderId} - ${party} - ${kind}.pdf` : `${orderId} - ${kind}.pdf`;
}

// Truck body labels used by the templates' "Tipo" dropdown
const LOAD_TYPE_PDF_LABELS: Record<(typeof LOADING_BAY)[number], string> = {
    "flatbed": "Plataforma",
    "dropsides": "Taipal",
    "tautliner": "Tautliner",
    "rigid-body": "Caixa Aberta",
    "refrigerated": "Refrigerado",
    "tipper": "Basculante",
    "side-tipper": "Basculante Lateral",
    "tanker": "Cisterna",
    "lowbed": "Porta Máquinas",
};

const pdfDate = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });

const normalize = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** Finds a form field by name, tolerating spacing/casing variants. */
function findField(form: PDFForm, name: string) {
    const wanted = normalize(name);

    return form.getFields().find((field) => normalize(field.getName()) === wanted);
}

function setText(form: PDFForm, name: string, value: string) {
    const field = findField(form, name);

    if (field instanceof PDFTextField) {
        field.setText(value);
    } else if (process.env.NODE_ENV !== "production") {
        console.warn(`[pdf] text field not found: ${name}`);
    }
}

function setDropdown(form: PDFForm, name: string, value: string) {
    const field = findField(form, name);

    if (field instanceof PDFDropdown) {
        // pdf-lib throws when selecting a value missing from the options
        // (e.g. USD in the MZN/ZAR-only "Moeda" dropdown) — extend first
        if (!field.getOptions().includes(value)) {
            field.setOptions([...field.getOptions(), value]);
        }

        field.select(value);
    } else if (process.env.NODE_ENV !== "production") {
        console.warn(`[pdf] dropdown not found: ${name}`);
    }
}

function setCheckbox(form: PDFForm, name: string, checked: boolean) {
    const field = findField(form, name);

    if (field instanceof PDFCheckBox) {
        if (checked) {
            field.check();
        } else {
            field.uncheck();
        }
    } else if (process.env.NODE_ENV !== "production") {
        console.warn(`[pdf] checkbox not found: ${name}`);
    }
}

const simNao = (value: boolean) => (value ? "SIM" : "NÃO");

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
    const doc = await PDFDocument.load(bytes);
    const form = doc.getForm();

    if (process.env.NODE_ENV !== "production") {
        console.debug(`[pdf] ${kind} fields:`, form.getFields().map((field) => field.getName()));
    }

    const price = kind === "shipper" ? values.shipperTotal : values.carrierTotal!;
    const currency = kind === "shipper" ? values.shipperCurrency : values.carrierCurrency!;

    setText(form, "Assunto", `${values.loadingAddress.address} - ${values.offloadingAddress.address}`);
    setText(form, "Número do Processo", orderId);
    setText(form, "Data", pdfDate.format(new Date()));
    setText(form, "Atenção de (nome do transportador)", kind === "shipper" ? values.shipperName : values.carrierName!);

    setText(form, "Origem", values.loadingAddress.address);
    setText(form, "Destino", values.offloadingAddress.address);
    setText(form, "Carga", values.description);
    setText(form, "Peso", values.weight.toFixed(3));
    setDropdown(form, "Unidade", values.weightUnit);
    setText(form, "Data de carregamento", pdfDate.format(values.expectedLoadingDate));

    setText(form, "Preço", price.toFixed(2));
    setDropdown(form, "Moeda", currency);

    setText(form, "Provedor de serviço de transporte", values.carrierName!);
    setText(form, "Matricula do Caminhão", values.truckPlate!);
    setText(
        form,
        "Detalhes do condutor",
        values.driverContact ? `${values.driverName!} - ${values.driverContact}` : values.driverName!,
    );
    if (values.loadingBay !== undefined) {
        setDropdown(form, "Tipo", LOAD_TYPE_PDF_LABELS[values.loadingBay]);
    }
    setCheckbox(form, "Carga Refrigerada", values.loadingBay === "refrigerated");

    setDropdown(form, "Trelha", simNao(!!values.trailerPlate));
    setText(form, "Matricula da Trelha", values.trailerPlate ?? "");

    if (kind === "shipper") {
        // Hollard GIT insurance through Appload
        setDropdown(form, "Hollard", simNao(values.insuranceValue !== undefined && values.insuranceValue > 0));
    }

    const filled = await doc.save();

    return new Blob([filled as unknown as BlobPart], { type: "application/pdf" });
}
