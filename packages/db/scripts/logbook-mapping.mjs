/**
 * Sheet -> database translation for the DEV DATABASE LOGBOOK.
 *
 * The app writes the logbook through apps/admin's orders-sheet-mapping.ts;
 * this is the same vocabulary read back the other way, plus the derivations
 * that fill what the logbook never recorded. Column positions are resolved
 * by header text at run time, so the sheet can gain or reorder columns.
 */

export const HEADER_ROW = 2; // 1-based; data starts on row 3

const normalizeHeader = (header) => String(header ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Header text -> zero-based column index, first occurrence wins. */
export function resolveColumns(headerRow) {
    const index = new Map();
    headerRow.forEach((header, position) => {
        const key = normalizeHeader(header);
        if (key && !index.has(key)) index.set(key, position);
    });
    return index;
}

export const hasColumn = (columns, header) => columns.has(normalizeHeader(header));

/**
 * Reads a row by header name. Headers reproduce the sheet's own spelling
 * ("Weight Uint", "Paymement", "Insuerance", "Is Hazarduos?") on purpose.
 */
export const reader = (columns) => (row, header) => {
    const position = columns.get(normalizeHeader(header));
    return position === undefined ? undefined : row[position];
};

// ---------------------------------------------------------------------------
// Scalars

export const text = (value) => {
    const trimmed = String(value ?? "").trim().replace(/\s+/g, " ");
    return trimmed === "" ? null : trimmed;
};

export const number = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = typeof value === "number" ? value : Number(String(value).replace(/[,\s]/g, "").replace(/km$/i, ""));
    return Number.isFinite(parsed) ? parsed : null;
};

export const integer = (value) => {
    const parsed = number(value);
    return parsed === null ? null : Math.round(parsed);
};

export const money = (value) => {
    const parsed = number(value);
    return parsed === null ? null : parsed.toFixed(2);
};

export const weight = (value) => {
    const parsed = number(value);
    return parsed === null ? null : parsed.toFixed(3);
};

/**
 * Percent-formatted columns come back as fractions under
 * UNFORMATTED_VALUE (1 = 100%), while the database stores 0-100.
 */
export const percent = (value) => {
    const parsed = number(value);
    return parsed === null ? null : String(Math.round(parsed * 100 * 100) / 100);
};

export const boolean = (value) => {
    if (typeof value === "boolean") return value;
    const trimmed = String(value ?? "").trim().toLowerCase();
    if (trimmed === "true" || trimmed === "yes" || trimmed === "sim") return true;
    if (trimmed === "false" || trimmed === "no" || trimmed === "nao" || trimmed === "não") return false;
    return null;
};

/** Sheet dates are English long form: "9 January 2026" / "January 9, 2026". */
export const date = (value) => {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    // Timestamps are stored naive; keep the calendar day the sheet shows
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")} 00:00:00`;
};

export const year = (value) => {
    const iso = date(value);
    return iso ? Number(iso.slice(0, 4)) : null;
};

// ---------------------------------------------------------------------------
// Dropdowns. Keys are the sheet's labels, lower-cased and whitespace-folded.

const lookup = (table) => (value) => table[normalizeHeader(value)] ?? null;

export const status = lookup({
    "prospects": "prospect",
    "prospect": "prospect",
    "booked": "booked",
    // "To Loading" was retired from the vocabulary: the sheet's own rows
    // still say it, and they land on the status that replaced it
    "to loading": "at-loading",
    "at loading": "at-loading",
    "loading": "loading",
    "waiting documents": "waiting-documents",
    "waiting for documents": "waiting-documents",
    "in transit": "on-route",
    "on route": "on-route",
    "stopped": "stopped",
    "issue": "issue",
    "at border": "at-border",
    "at offloading": "at-offloading",
    "offloading": "offloading",
    "delivered": "delivered",
    "completed": "completed",
    "cancelled": "cancelled",
    "canceled": "cancelled",
    "underbid": "underbid",
});

export const podStatus = lookup({
    "pending collection": "pending-collection",
    "pending delivery": "pending-delivery",
    "delivered": "delivered",
    "verified": "verified",
});

export const route = lookup({ "national": "national", "regional": "regional" });
export const tripType = lookup({ "normal": "normal", "backload": "backload" });
export const loadType = lookup({ "dedicated": "dedicated", "groupage": "groupage" });
export const truckAge = lookup({ "recent": "recent", "non recent": "not-recent", "not recent": "not-recent" });
export const currency = lookup({ "mzn": "MZN", "zar": "ZAR", "usd": "USD" });
export const weightUnit = lookup({ "ton": "ton", "tons": "ton", "kg": "kg", "liter": "liter", "litre": "liter" });

export const paymentStatus = lookup({
    "pending": "pending",
    "pending payment": "pending",
    "partially": "partially",
    "partially paid": "partially",
    "completed": "completed",
    "payment completed": "completed",
    "not applicable": "not-applicable",
    "not appliable": "not-applicable",
    "n/a": "not-applicable",
});

export const insuranceStatus = lookup({
    "to be paid": "pending",
    "pending": "pending",
    "paid": "paid",
    "n/a": "not-applicable",
    "not applicable": "not-applicable",
});

// Free text in the database; "Not Required" means there is no insurance leg
export const insuranceSubscriber = lookup({ "appload": "appload", "client": "shipper", "shipper": "shipper" });

export const category = lookup({
    "agricultural inputs": "agriculture-inputs",
    "agriculture inputs": "agriculture-inputs",
    "agricultural products": "agriculture-products",
    "agriculture products": "agriculture-products",
    "construction materials": "construction",
    "construction": "construction",
    "machinery & equipment": "machinery-equipment",
    "mining & minerals": "mining",
    "mining": "mining",
    "oil & gas": "oil-gas",
    "fmcg (fast-moving consumer goods)": "fmcg",
    "fmcg": "fmcg",
    "pharmaceuticals & medical supplies": "medicine",
    "medicine": "medicine",
    "general cargo": "general-cargo",
    "vehicles & automotive": "vehicles",
    "vehicles": "vehicles",
    "other": "other",
});

export const packing = lookup({
    "bag (1 kg)": "bags-1kg", "bag (2 kg)": "bags-2kg", "bag (5 kg)": "bags-5kg",
    "bag (25 kg)": "bags-25kg", "bag (30 kg)": "bags-30kg", "bag (50 kg)": "bags-50kg",
    "bag (100 kg)": "bags-100kg", "bag (1 ton)": "bags-1ton",
    "bottle (1 l)": "bottle-1l", "bottle (5 l)": "bottle-5l", "bottle (10 l)": "bottle-10l",
    "bottle (20 l)": "bottle-20l", "bottle (25 l)": "bottle-25l",
    "20ft container": "container-20ft", "40ft container": "container-40ft",
    "boxes": "boxes", "pallets": "pallets", "no packing": "noPacking", "other": "other",
});

/**
 * The sheet stores the regime as its VAT rate, and UNFORMATTED_VALUE hands
 * it over as a fraction (0.16), so both spellings are accepted.
 */
export function fiscalRegime(value) {
    const label = normalizeHeader(value);
    if (label === "n/a" || label === "na") return "n/a";
    const parsed = number(value);
    if (parsed === null) return null;
    const rate = parsed > 1 ? parsed / 100 : parsed;
    if (Math.abs(rate - 0.16) < 0.001) return "normal";
    if (Math.abs(rate - 0.05) < 0.001) return "simplified-5";
    if (Math.abs(rate - 0.03) < 0.001) return "simplified-3";
    if (rate === 0) return "n/a";
    return null;
}

// ---------------------------------------------------------------------------
// Cargo category from the free-text description.
//
// The logbook only ever filled the Cargo Category dropdown on 29 of 1197
// rows, but the description is almost always there — in a mix of Portuguese
// and English. Rules are ordered: the first match wins, so the specific
// patterns come before the catch-alls.

// Descriptions are matched against an accent-stripped, lower-cased copy:
// \b is ASCII-only in JavaScript, so "aguas residuais" is matchable while
// "águas residuais" is not. Tokens meant as prefixes carry an explicit \w*
// — a bare \b after "fertiliz" would refuse to match "fertilizer".
const foldAccents = (value) =>
    String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const CATEGORY_RULES = [
    [/\b(adubo\w*|fertiliz\w*|fertliz\w*|ureia|urea|npk|nitrog\w*|calcario\w*|dolomite|enxada\w*)\b/, "agriculture-inputs"],
    [/\b(semente\w*|seed|seeds|muda|mudas)\b/, "agriculture-inputs"],
    [/\b(quimic\w*|chemical\w*|pesticid\w*|herbicid\w*|fungicid\w*|insecticid\w*|agroqu\w*)\b/, "agriculture-inputs"],
    [/\b(racao|feed|feeds|farelo|bran|premix|semea)\b/, "agriculture-inputs"],
    [/\b(agricultur\w*\s*(input|inputs)|insumo\w*)\b/, "agriculture-inputs"],

    [/\b(milho|maize|corn|soja|soya|soybean\w*|trigo|wheat|arroz|rice|feijao|feijaao|bean|beans|amendoim|groundnut\w*|gergelim|sesame|sorgo|sorghum|mapira|mexoeira|algodao|cotton|castanha\w*|cashew\w*|nut|nuts|caju|macadamia|batata\w*|potato|potatoes|cebola\w*|onion\w*|tomate\w*|banana\w*|fruta\w*|fruit\w*|vegetable\w*|hortic\w*|tabaco|tobacco|cha|tea|acucar|sugar|cana|copra|coco|cafe|coffee|mamona|malambe)\b/, "agriculture-products"],
    [/\b(mel|honey|peixe|fish|carne|meat|frango|chicken|leite|milk|ovo|ovos|egg|eggs|camarao|prawn\w*|lagosta|porridge|food\w*)\b/, "agriculture-products"],
    [/\b(produto\w*\s*agricola\w*|agricultur\w*\s*product\w*|plants?)\b/, "agriculture-products"],

    [/\b(cimento|cement|brita|gravel|tijolo\w*|brick\w*|bloco\w*|aco|steel|ferro|iron|vergalh\w*|rebar|madeira|timber|wood|travessa\w*|sleeper\w*|telha\w*|roof\w*|tinta\w*|paint|tubo\w*|pipe\w*|poste\w*|pole\w*|cofragem|betao|concrete|constru\w*|construction|carpentry|carpetry|metalic\w*|ceramic\w*|cerami\w*)\b/, "construction"],

    [/\b(maquina\w*|machine\w*|machinery|equipment\w*|equipamento\w*|trator|tractor\w*|escavador\w*|excavator\w*|gerador\w*|generator\w*|compressor\w*|guindaste\w*|crane|bomba\w*|pump|pumps|motor|turbina|hydraulic|solar|painel|paineis|panel\w*)\b/, "machinery-equipment"],
    [/\b(material\s*electric\w*|material\s*eletric\w*|electric\w*\s*material|cabo|cabos|cable\w*|transformador\w*)\b/, "machinery-equipment"],

    [/\b(carvao|coal|minerio\w*|ore|grafite|graphite|bauxit\w*|ilmenit\w*|tantalit\w*|areia\w*|sand|sands|limestone|ouro|gold|rubi|ruby|gema\w*|granito|granite|marmore|marble|pedra\w*|stone\w*|clinquer|clinker)\b/, "mining"],

    [/\b(combustivel|fuel|diesel|gasolina|petrol|gasoil|oleo|oil|lubrificante\w*|lubricant\w*|gas|lpg|betume|bitumen|asfalto|asphalt)\b/, "oil-gas"],

    [/\b(medicament\w*|medicine\w*|farmac\w*|pharma\w*|medico\w*|medical|vacina\w*|vaccine\w*|hospital\w*|reagente\w*|laborat\w*)\b/, "medicine"],

    [/\b(veiculo\w*|vehicle\w*|viatura\w*|carro\w*|car|camiao|truck|moto|motoci\w*|motorcycle\w*|bike\w*|bicicleta\w*|automovel|automotive|peca\w*|spare\s*parts)\b/, "vehicles"],

    [/\b(bebida\w*|beverage\w*|cerveja\w*|beer|refrigerante\w*|soda|agua\s*mineral|garrafa\w*|bottle\w*|sabao|soap|detergente\w*|detergent\w*|higiene|cosmetic\w*|cosmetico\w*|fralda\w*|diaper\w*|papel\s*higi\w*|tissue\w*|snack\w*|biscoito\w*|biscuit\w*|massa\w*|pasta|farinha|flour|sal|salt|oleo\s*alimentar|cooking\s*oil|enlatado\w*|canned|supermercado|retail|fmcg|uniforme\w*|capatilha\w*|sapato\w*|shoe\w*|tecido\w*|fabric\w*|tv|tvs)\b/, "fmcg"],

    [/\b(agua\s*residual|aguas\s*residuais|residuo\w*|waste|lixo|entulho|sucata|scrap|reciclagem|recycl\w*|lama\s*contaminada|contaminated)\b/, "other"],
    [/\b(saco\w*\s*vazio\w*|empty\s*bag\w*|bidon\w*\s*vazio\w*|empty\s*drum\w*|contentor\s*vazio|empty\s*container\w*|vazio\w*|empty)\b/, "other"],
    [/\b(carga\s*geral|general\s*cargo|diverso\w*|misto|mixed|mercadoria\w*|goods|carga\s*industrial|industrial|industrias|palete\w*|pallet\w*|caixa\w*|box|boxes|fardo\w*|bale\w*|cadeira\w*|chair\w*|material\s*de\s*escritorio|office\s*suppl\w*)\b/, "general-cargo"],
];

export function categoryFromDescription(description) {
    const value = foldAccents(description).trim();
    // "nda" is the logbook's own shorthand for "no data"
    if (!value || value === "nda" || value === "n/a") return null;
    for (const [pattern, result] of CATEGORY_RULES) if (pattern.test(value)) return result;
    return null;
}

// ---------------------------------------------------------------------------
// Derivations for columns the logbook never filled

/**
 * National means both ends sit in the same country; anything crossing a
 * border is regional. Falls back to the sheet when a place could not be
 * resolved to a country.
 */
export function deriveRoute(loading, offloading, stated) {
    if (loading?.country && offloading?.country) {
        return loading.country === offloading.country ? "national" : "regional";
    }
    return stated ?? "national";
}

/**
 * Proof-of-delivery state implied by where the trip got to. The logbook only
 * ever recorded "Verified", and only on completed trips.
 */
export function derivePodStatus(orderStatus) {
    switch (orderStatus) {
        case "completed":
            return "verified";
        case "delivered":
        case "offloading":
        case "at-offloading":
            return "delivered";
        case "on-route":
        case "at-border":
        case "stopped":
        case "issue":
        case "waiting-documents":
            return "pending-collection";
        default:
            // prospect, booked, at-loading, loading, cancelled,
            // underbid: nothing to collect yet
            return null;
    }
}

/**
 * Full load or shared. Measured against the 243 rows that state it, the
 * 10-tonne split is right 86% of the time — the two populations barely
 * overlap (groupage tops out at 12.5 t, dedicated sits at a 30 t median).
 */
export function deriveLoadType(tons) {
    if (tons === null) return null;
    return tons >= 10 ? "dedicated" : "groupage";
}

/** Transit days at the ~450 km/day a Mozambican long-haul trip averages. */
export function estimateTransitDays(km) {
    if (km === null || km <= 0) return 1;
    return Math.max(1, Math.ceil(km / 450));
}

export function addDays(isoTimestamp, days) {
    if (!isoTimestamp) return null;
    const parsed = new Date(`${isoTimestamp.slice(0, 10)}T00:00:00Z`);
    parsed.setUTCDate(parsed.getUTCDate() + days);
    return `${parsed.toISOString().slice(0, 10)} 00:00:00`;
}

export function daysBetween(from, to) {
    if (!from || !to) return null;
    const a = new Date(`${from.slice(0, 10)}T00:00:00Z`).getTime();
    const b = new Date(`${to.slice(0, 10)}T00:00:00Z`).getTime();
    const days = Math.round((b - a) / 86_400_000);
    return days >= 0 ? days : null;
}
