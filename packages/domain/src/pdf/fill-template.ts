import { PDFCheckBox, PDFDocument, PDFDropdown, PDFTextField, type PDFForm } from "pdf-lib";

import type { LOADING_BAY } from "@workspace/db/types";

/**
 * Filling Appload's booking-confirmation templates.
 *
 * The two templates are hand-drawn Portuguese AcroForms, and the map between
 * their field names and the load's data is the only thing that makes the
 * paper right — so it lives here once instead of in whichever app happens to
 * print it: the admin sends an order's confirmation, the portal a company's
 * own confirmation to the partner it placed a load with.
 *
 * The caller hands over the bytes rather than a path. This runs in the
 * browser — pdf-lib fills the form there and the app uploads the result — and
 * each app ships its own copy of the template under `public/templates`.
 */

export type TemplateKind = "shipper" | "carrier";

/** The exact slice of load data the templates read. */
export type TemplateValues = {
    /** What the paper calls the process: an order id, or a portal load's reference */
    reference: string;
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
export function findField(form: PDFForm, name: string) {
    const wanted = normalize(name);

    return form.getFields().find((field) => normalize(field.getName()) === wanted);
}

export function setText(form: PDFForm, name: string, value: string) {
    const field = findField(form, name);

    if (field instanceof PDFTextField) {
        field.setText(value);
    } else if (process.env.NODE_ENV !== "production") {
        console.warn(`[pdf] text field not found: ${name}`);
    }
}

export function setDropdown(form: PDFForm, name: string, value: string) {
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

/** Fills one of the booking-confirmation templates with the load's data. */
export async function fillTemplate(
    templateBytes: ArrayBuffer,
    kind: TemplateKind,
    values: TemplateValues,
): Promise<Uint8Array> {
    const doc = await PDFDocument.load(templateBytes);
    const form = doc.getForm();

    if (process.env.NODE_ENV !== "production") {
        console.debug(`[pdf] ${kind} fields:`, form.getFields().map((field) => field.getName()));
    }

    const price = kind === "shipper" ? values.shipperTotal : values.carrierTotal!;
    const currency = kind === "shipper" ? values.shipperCurrency : values.carrierCurrency!;

    setText(form, "Assunto", `${values.loadingAddress.address} - ${values.offloadingAddress.address}`);
    setText(form, "Número do Processo", values.reference);
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
    // Either half can be missing: booking commits a carrier, and the driver
    // is only owed at dispatch, so a document printed in between must not
    // read "undefined - +258…"
    setText(
        form,
        "Detalhes do condutor",
        [values.driverName, values.driverContact].filter(Boolean).join(" - "),
    );
    // Both read the body type, so both wait for it: an unknown body is not a
    // body that is not refrigerated, and the box must not say it is
    if (values.loadingBay !== undefined) {
        setDropdown(form, "Tipo", LOAD_TYPE_PDF_LABELS[values.loadingBay]);
        setCheckbox(form, "Carga Refrigerada", values.loadingBay === "refrigerated");
    }

    setDropdown(form, "Trelha", simNao(!!values.trailerPlate));
    setText(form, "Matricula da Trelha", values.trailerPlate ?? "");

    if (kind === "shipper") {
        // Hollard GIT insurance through Appload
        setDropdown(form, "Hollard", simNao(values.insuranceValue !== undefined && values.insuranceValue > 0));
    }

    return doc.save();
}
