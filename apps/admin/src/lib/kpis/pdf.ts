import { PDFDocument, type PDFForm } from "pdf-lib";

import { createFormatter } from "@workspace/i18n";

import { safeFileName, setDropdown, setText } from "@/lib/orders/pdf";
import { lastDay, utcDay, type KpiReport, type PartyType } from "@/frontend/pages/kpis/types";

/**
 * The KPI report as one of Claire's four AcroForm templates.
 *
 * The templates are printed forms, not a layout this code owns: every row is a
 * fixed `(unit dropdown, value text field)` pair at a fixed place on the page,
 * and the names are positional — `Text Field 24` is "average loading duration"
 * only because that is where it sits. So the maps below are the whole design,
 * and they are ordered exactly as the pages read. Two of them differ: the
 * English carrier template has no "transports analysed" summary row (the count
 * still goes in the header), and the Portuguese carrier template names one unit
 * dropdown `Combo Box 49`.
 *
 * The language of the PDF is the reader's, not the app's: a Portuguese report
 * downloaded from an English session still prints "setembro de 2026", so every
 * value is formatted through a formatter built for the PDF's own locale rather
 * than the page's. Money is USD throughout — the conversion happened per trip,
 * at its own loading-day rate, long before this file sees a figure — so the
 * unit dropdowns are extended with "USD", which the templates never offered.
 *
 * Nothing here touches the transport-id field or the three Communication rows:
 * ratings live on a manual tab of the sheet and are not tracked in the app, so
 * their fields keep the template's own defaults instead of printing a zero.
 */

export type KpiLang = "en" | "pt";

/** Which of the four templates a report prints on. */
export type KpiTemplate = `${PartyType}-${KpiLang}`;

const TEMPLATE_PATHS: Record<KpiTemplate, string> = {
    "shipper-en": "/templates/kpi-shipper-en.pdf",
    "shipper-pt": "/templates/kpi-shipper-pt.pdf",
    "carrier-en": "/templates/kpi-carrier-en.pdf",
    "carrier-pt": "/templates/kpi-carrier-pt.pdf",
};

// The header block of page 1, identical in all four templates
const NAME = "Name";
const TYPE = "Combo Box 1";
const FROM = "Text Field 5";
const TO = "Text Field 6";
const ORIGINS = "Text Field 48";
const DESTINATIONS = "Text Field 49";
const TRANSPORTS = "Text Field 50";

type FieldPair = readonly [unit: string, value: string];

/** Page 1, shipper EN/PT and carrier PT: transports first, then the totals. */
const SUMMARY_8: readonly FieldPair[] = [
    ["Combo Box 3", "Text Field 8"],
    ["Combo Box 4", "Text Field 10"],
    ["Combo Box 36", "Text Field 12"],
    ["Combo Box 6", "Text Field 14"],
    ["Combo Box 7", "Text Field 16"],
    ["Combo Box 8", "Text Field 18"],
    ["Combo Box 9", "Text Field 20"],
    ["Combo Box 48", "Text Field 52"],
];

/** Page 1, carrier EN: the same rows shifted up one, with no transports row. */
const SUMMARY_CARRIER_EN: readonly FieldPair[] = [
    ["Combo Box 3", "Text Field 8"],
    ["Combo Box 4", "Text Field 10"],
    ["Combo Box 36", "Text Field 12"],
    ["Combo Box 6", "Text Field 14"],
    ["Combo Box 7", "Text Field 16"],
    ["Combo Box 8", "Text Field 18"],
    ["Combo Box 9", "Text Field 20"],
];

/** Pages 2 and 3, identical in all four templates but for the override below. */
const DETAIL: readonly FieldPair[] = [
    ["Combo Box 11", "Text Field 23"],
    ["Combo Box 12", "Text Field 24"],
    ["Combo Box 37", "Text Field 25"],
    ["Combo Box 14", "Text Field 26"],
    ["Combo Box 15", "Text Field 27"],
    ["Combo Box 38", "Text Field 28"],
    ["Combo Box 39", "Text Field 29"],
    ["Combo Box 40", "Text Field 30"],
    ["Combo Box 19", "Text Field 31"],
    ["Combo Box 20", "Text Field 32"],
    ["Combo Box 41", "Text Field 33"],
    ["Combo Box 42", "Text Field 34"],
    ["Combo Box 43", "Text Field 35"],
    ["Combo Box 44", "Text Field 36"],
    ["Combo Box 25", "Text Field 37"],
    ["Combo Box 26", "Text Field 38"],
    ["Combo Box 27", "Text Field 39"],
    ["Combo Box 28", "Text Field 40"],
    ["Combo Box 29", "Text Field 41"],
    ["Combo Box 30", "Text Field 42"],
    ["Combo Box 31", "Text Field 43"],
    ["Combo Box 32", "Text Field 44"],
];

// The average-transport-duration unit is the one field the carrier PT template
// numbers differently. The same name exists on page 3 of the shipper PT
// template, where it is a star rating — hence the template-scoped swap rather
// than a second entry in the map.
const TRANSPORT_DAYS_UNIT = "Combo Box 37";
const CARRIER_PT_TRANSPORT_DAYS_UNIT = "Combo Box 49";

/** The templates' own spellings, so a filled form reads like a printed one. */
const UNITS = {
    en: {
        number: "Number",
        money: "USD",
        tons: "Tons",
        km: "Kms",
        days: "Days",
        kmPerDay: "Kms/Day",
        // The percentage rows are worded as questions ("on time?"), so the
        // sheet answers "Yes" in the unit column and prints "83%" beside it
        percent: "Yes",
        share: "Percentage",
        perKm: "USD/Km",
        perTon: "USD/Ton",
        perTonKm: "USD/Ton-Km",
        co2: "Kg/Ton transported",
    },
    pt: {
        number: "Número",
        money: "USD",
        tons: "Tons",
        km: "Kms",
        days: "Dias",
        kmPerDay: "Kms/Dia",
        percent: "Sim",
        share: "Percentagem",
        perKm: "USD/Km",
        perTon: "USD/Ton",
        perTonKm: "USD/Ton-Km",
        co2: "Kg/Ton transportada",
    },
} satisfies Record<KpiLang, Record<string, string>>;

const HEADER_WORDS = {
    en: { type: "Multiple", origins: "All origins", destinations: "All destinations" },
    pt: { type: "Multiplo", origins: "Todas as origens", destinations: "Todos os destinos" },
} satisfies Record<KpiLang, Record<string, string>>;

/** What an empty divisor prints: never a zero, which would read as a figure. */
const MISSING = "-";

type ValueRow = { unit: string; value: string };

/** Every string the templates print, formatted in the PDF's own language. */
export type KpiPdfValues = {
    header: {
        name: string;
        type: string;
        from: string;
        to: string;
        origins: string;
        destinations: string;
        transports: string;
    };
    /** The eight summary rows in template order; carrier EN drops the first. */
    summary: ValueRow[];
    /** The twenty-two detail rows of pages 2 and 3, in template order. */
    detail: ValueRow[];
};

export function kpiPdfValues(report: KpiReport, lang: KpiLang): KpiPdfValues {
    const formatter = createFormatter({ locale: lang, timeZone: "Africa/Maputo" });
    const unit = UNITS[lang];
    const words = HEADER_WORDS[lang];
    const kpis = report.kpis;

    const number = (value: number | null, digits = 0): string =>
        value === null ? MISSING : formatter.number(value, { minimumFractionDigits: digits === 2 ? 2 : 0, maximumFractionDigits: digits });
    const percent = (value: number | null): string =>
        value === null ? MISSING : formatter.number(value, { style: "percent", maximumFractionDigits: 0 });
    const date = (day: string): string => formatter.dateTime(utcDay(day), { dateStyle: "medium" });

    return {
        header: {
            name: report.party.name,
            type: words.type,
            from: date(report.period.from),
            to: date(report.period.to),
            origins: words.origins,
            destinations: words.destinations,
            transports: number(kpis.transports),
        },
        summary: [
            { unit: unit.number, value: number(kpis.transports) },
            { unit: unit.money, value: number(kpis.total) },
            { unit: unit.money, value: number(kpis.pricePerTransport) },
            { unit: unit.number, value: number(kpis.deliveries) },
            { unit: unit.tons, value: number(kpis.tons, 1) },
            { unit: unit.km, value: number(kpis.km) },
            { unit: unit.tons, value: number(kpis.tonsPerTransport, 1) },
            { unit: unit.km, value: number(kpis.kmPerTransport) },
        ],
        detail: [
            { unit: unit.percent, value: percent(kpis.onTimeLoadingRate) },
            { unit: unit.days, value: number(kpis.avgLoadingDays, 1) },
            { unit: unit.days, value: number(kpis.avgTravelDays, 1) },
            { unit: unit.kmPerDay, value: number(kpis.kmPerDay, 1) },
            { unit: unit.percent, value: percent(kpis.onTimeOffloadingRate) },
            { unit: unit.days, value: number(kpis.avgOffloadingDays, 1) },
            { unit: unit.days, value: number(kpis.avgBorderDays, 1) },
            { unit: unit.percent, value: percent(kpis.demurrageRate) },
            { unit: unit.days, value: number(kpis.demurrageDays, 1) },
            { unit: unit.number, value: number(kpis.accidents) },
            { unit: unit.number, value: number(kpis.mechanical) },
            { unit: unit.number, value: number(kpis.documentation) },
            { unit: unit.number, value: number(kpis.police) },
            { unit: unit.days, value: number(kpis.delayDays, 1) },
            { unit: unit.percent, value: percent(kpis.damageRate) },
            { unit: unit.percent, value: percent(kpis.claimRate) },
            { unit: unit.perKm, value: number(kpis.costPerKm, 2) },
            { unit: unit.perTon, value: number(kpis.costPerTon, 2) },
            { unit: unit.perTonKm, value: number(kpis.costPerTonKm, 2) },
            { unit: unit.share, value: percent(kpis.backloadShare) },
            { unit: unit.co2, value: number(kpis.co2) },
            // The last backload row asks a different question of each side:
            // what the shipper saved (USD), or the margin the carrier kept
            // over the fuel its backload trips burned (a percentage)
            kpis.backload.kind === "savings"
                ? { unit: unit.money, value: number(kpis.backload.value) }
                : { unit: unit.share, value: percent(kpis.backload.value) },
        ],
    };
}

/** Writes one row's pair; the unit always goes through the extending select. */
const writeRows = (form: PDFForm, fields: readonly FieldPair[], rows: readonly ValueRow[], template: KpiTemplate) => {
    fields.forEach(([unitField, valueField], index) => {
        const row = rows[index];

        if (!row) return;

        setDropdown(
            form,
            template === "carrier-pt" && unitField === TRANSPORT_DAYS_UNIT
                ? CARRIER_PT_TRANSPORT_DAYS_UNIT
                : unitField,
            row.unit,
        );
        setText(form, valueField, row.value);
    });
};

/**
 * Fills a loaded template with already-formatted values. Kept apart from the
 * fetching half so the field maps can be checked against real template bytes
 * from a script, without a browser.
 */
export function fillKpiDocument(doc: PDFDocument, template: KpiTemplate, values: KpiPdfValues): void {
    const form = doc.getForm();
    const { header } = values;

    setText(form, NAME, header.name);
    setDropdown(form, TYPE, header.type);
    setText(form, FROM, header.from);
    setText(form, TO, header.to);
    setText(form, ORIGINS, header.origins);
    setText(form, DESTINATIONS, header.destinations);
    setText(form, TRANSPORTS, header.transports);

    // Carrier EN has no transports row of its own, so its seven rows start at
    // the total — the count the other three print there is in the header
    const carrierEn = template === "carrier-en";

    writeRows(form, carrierEn ? SUMMARY_CARRIER_EN : SUMMARY_8, carrierEn ? values.summary.slice(1) : values.summary, template);
    writeRows(form, DETAIL, values.detail, template);
}

/**
 * Fetches the template for this report's side and language, fills it and hands
 * back the bytes to download. Runs in the browser; templates live in public/.
 */
export async function fillKpiTemplate(report: KpiReport, lang: KpiLang): Promise<Blob> {
    const template: KpiTemplate = `${report.type}-${lang}`;
    const bytes = await fetch(TEMPLATE_PATHS[template]).then((response) => response.arrayBuffer());
    const doc = await PDFDocument.load(bytes);

    fillKpiDocument(doc, template, kpiPdfValues(report, lang));

    const filled = await doc.save();

    return new Blob([filled as unknown as BlobPart], { type: "application/pdf" });
}

/**
 * The period as the PDF says it. The report carries only its two ends, so the
 * preset is read back off them: a whole calendar year, month or quarter names
 * itself, and anything else prints as the range it is.
 */
function periodLabel(period: KpiReport["period"], lang: KpiLang): string {
    const formatter = createFormatter({ locale: lang, timeZone: "Africa/Maputo" });
    const from = utcDay(period.from);
    const to = utcDay(period.to);
    const [year, month, day] = [from.getUTCFullYear(), from.getUTCMonth() + 1, from.getUTCDate()];
    const sameYear = to.getUTCFullYear() === year;
    const endsMonth = to.getUTCDate() === lastDay(to.getUTCFullYear(), to.getUTCMonth() + 1);

    if (sameYear && day === 1 && endsMonth) {
        const months = to.getUTCMonth() + 1 - month;

        if (month === 1 && months === 11) return String(year);
        if (months === 0) return formatter.dateTime(from, { year: "numeric", month: "long" });
        if (months === 2 && month % 3 === 1) {
            const quarter = (month + 2) / 3;
            return lang === "en" ? `Q${quarter} ${year}` : `${quarter}.º trimestre de ${year}`;
        }
    }

    return `${formatter.dateTime(from, { dateStyle: "medium" })} – ${formatter.dateTime(to, { dateStyle: "medium" })}`;
}

/** Download name: whose report, over what, in which language. */
export function kpiFileName(report: KpiReport, lang: KpiLang): string {
    return `KPI - ${safeFileName(report.party.name)} - ${periodLabel(report.period, lang)} - ${lang.toUpperCase()}.pdf`;
}
