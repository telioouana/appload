import "server-only";

import { getServiceAccountAccessToken } from "@/lib/orders/service-account-token";
import { emptyMonth } from "@/lib/metrics/orders";
import { asRateSource, monthKey, type RateRow, type SheetMonth } from "@/frontend/pages/metrics/types";

/**
 * The DATABASE LOGBOOK's MONTHLY RATES tab, read as data rather than as a
 * document: one pinned opening rate per month, which Claire can override by
 * typing over the number. The figures themselves come from the database
 * (orders.ts) — the logbook's ORDERS tab only mirrors it.
 *
 * Everything is fetched with the service account, whatever
 * NEXT_PUBLIC_GOOGLE_SHEETS_AUTH_MODE says — the metrics page is read-only
 * reporting and must not depend on whose Google account is linked.
 */

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

export const RATES_SHEET = "MONTHLY RATES";
const RATES_RANGE = "A1:F";
const RATES_HEADER = ["Month", "USD→MZN", "USD→ZAR", "Source", "Pinned on", "Note"];

// A month's rate is pinned once and edited by hand at most; a request that
// misses the window pays two API calls, the rest are free
const CACHE_TTL_MS = 10 * 60 * 1000;

// The caller is a user-facing query, so a hung Google call must not hold the
// request open longer than the client is willing to wait
const TIMEOUT_MS = 10_000;

// Sheets counts days from 1899-12-30, so 25569 is the Unix epoch
const SERIAL_EPOCH = 25569;
const DAY_MS = 86_400_000;

/** The rates the timeline is converted with, as one read. */
export type MetricsSnapshot = {
    rates: RateRow[];
    /** ISO instant of the last *successful* read, not of this call */
    fetchedAt: string;
    stale: boolean;
    spreadsheetId: string;
};

export class SheetsError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "SheetsError";
    }
}

function reason(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`;

    return String(error);
}

/**
 * The logbook's id — the same spreadsheet the orders sync writes to, so the
 * page and the sync can never disagree about which document is the record.
 * Read per call rather than captured at module load, so a redeployed env var
 * takes effect without a rebuild (the rule lib/maps/routes.ts follows).
 */
export function spreadsheetId(): string {
    const id = process.env.GOOGLE_SHEETS_ORDERS_SPREADSHEET_ID;

    if (!id) {
        throw new Error("[metrics] GOOGLE_SHEETS_ORDERS_SPREADSHEET_ID is not set — the metrics page has no logbook to read");
    }

    return id;
}

const MAPUTO_MONTH = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Maputo", year: "numeric", month: "2-digit" });

/**
 * "2026-09" in Maputo time. Everything on this page — the last month of the
 * timeline, the "to date" mark, the newest rate the feed will be asked for —
 * hangs off Claire's calendar, not off whichever region the server booted in.
 */
export const currentMaputoMonth = (): string => MAPUTO_MONTH.format(new Date());

async function sheetsFetch(accessToken: string, url: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(url, {
        ...init,
        headers: {
            ...init?.headers,
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");

        throw new SheetsError(response.status, `Sheets API responded ${response.status}: ${body.slice(0, 400)}`);
    }

    return response.json();
}

const rangeUrl = (id: string, sheet: string, a1: string) =>
    `${SHEETS_API}/${id}/values/${encodeURIComponent(`'${sheet}'!${a1}`)}`;

/**
 * UNFORMATTED_VALUE keeps numbers as numbers (the sheet prints them with
 * thousands separators and a currency suffix); SERIAL_NUMBER keeps the date
 * columns as the serials they are. Cells a formula cannot compute come back
 * as strings such as "#DIV/0!" and are read as 0.
 */
export async function readValues(accessToken: string, id: string, sheet: string, a1: string): Promise<unknown[][]> {
    const data = (await sheetsFetch(
        accessToken,
        `${rangeUrl(id, sheet, a1)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
    )) as { values?: unknown[][] };

    return data.values ?? [];
}

/**
 * The rates tab does not exist until the first month is pinned, and the API
 * answers a range on a missing tab with 400. Only that one status is read as
 * "no rows": a 500 or a revoked token must fail the whole snapshot, because
 * an empty rates list would send the app off to re-fetch and re-append every
 * month already sitting in the sheet.
 */
async function readRateRows(accessToken: string, id: string): Promise<unknown[][]> {
    try {
        return await readValues(accessToken, id, RATES_SHEET, RATES_RANGE);
    } catch (error) {
        if (error instanceof SheetsError && error.status === 400) return [];

        throw error;
    }
}

/**
 * The "Pinned on" cell as an ISO instant, or null when it is not one. That
 * column is Claire's as much as the app's — the footnote invites her to edit
 * the row — and the read asks for SERIAL_NUMBER, so a date typed into Sheets
 * arrives as the number 46271 and a word typed there arrives as a word.
 * Handing either to `new Date()` downstream prints the year 46271 or throws
 * inside the formatter, so only a real instant leaves this function.
 */
function parsePinnedOn(value: unknown): string | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        const at = new Date((value - SERIAL_EPOCH) * DAY_MS);

        return Number.isNaN(at.getTime()) ? null : at.toISOString();
    }

    const text = String(value ?? "").trim();

    // The app writes an ISO instant; anything not opening with a calendar
    // date is a note somebody left, not a moment
    if (!/^\d{4}-\d{2}-\d{2}/.test(text) || !Number.isFinite(Date.parse(text))) {
        return null;
    }

    return text;
}

function parseRates(rows: unknown[][]): RateRow[] {
    const parsed: RateRow[] = [];

    // Row 1 is the header, whatever it says
    for (const row of rows.slice(1)) {
        const month = String(row[0] ?? "").trim();

        if (!/^\d{4}-\d{2}$/.test(month)) continue;

        const usdMzn = Number(row[1]);
        const usdZar = Number(row[2]);

        if (!Number.isFinite(usdMzn) || usdMzn <= 0 || !Number.isFinite(usdZar) || usdZar <= 0) {
            console.warn(`[metrics] ${RATES_SHEET} row ${month} holds no usable rate — ignored`);

            continue;
        }

        const note = String(row[5] ?? "").trim();

        parsed.push({
            month,
            usdMzn,
            usdZar,
            source: asRateSource(row[3]),
            pinnedOn: parsePinnedOn(row[4]),
            note: note || null,
        });
    }

    return parsed;
}

/** Anything at all happened: a trip ran, or money was invoiced. */
function hasActivity(month: SheetMonth): boolean {
    const { sales, commission } = month.native;
    const money = sales.MZN + sales.ZAR + sales.USD + commission.MZN + commission.ZAR + commission.USD;

    return month.trips.total > 0 || money > 0;
}

/**
 * The months the orders fall in, cut down to the timeline the page draws:
 * from the first month Appload traded to the current Maputo month,
 * contiguous, with the quiet months in between filled in so a chart's x-axis
 * never skips one. An order dated in the future (a booking for next month)
 * is left for the month to arrive.
 */
export function timeline(rows: SheetMonth[], currentMonth: string): SheetMonth[] {
    const byKey = new Map<string, SheetMonth>();

    for (const row of rows) {
        const key = monthKey(row.year, row.month);

        if (key <= currentMonth) byKey.set(key, row);
    }

    const keys = [...byKey.keys()].sort();
    const first = keys.find((key) => hasActivity(byKey.get(key)!));

    if (!first) return [];

    const months: SheetMonth[] = [];
    let year = Number(first.slice(0, 4));
    let month = Number(first.slice(5));

    for (let key = first; key <= currentMonth; key = monthKey(year, month)) {
        months.push(byKey.get(key) ?? emptyMonth(year, month));

        if (month === 12) {
            year += 1;
            month = 1;
        } else {
            month += 1;
        }
    }

    return months;
}

// Module scope, so the snapshot lives as long as the serverless instance:
// every request is served the rates from one read of the spreadsheet
let cache: { snapshot: MetricsSnapshot; readAt: number } | null = null;

// The read in progress, if any; see readSnapshot
let inFlight: Promise<MetricsSnapshot> | null = null;

/**
 * The pinned rates, from cache while they are fresh. A read
 * that fails serves the last good snapshot flagged `stale` — the header says
 * so and the numbers stay on screen; only a cold instance with nothing to
 * fall back on throws.
 */
export function readSnapshot(): Promise<MetricsSnapshot> {
    if (cache && Date.now() - cache.readAt < CACHE_TTL_MS) {
        return Promise.resolve(cache.snapshot);
    }

    // Cold requests landing together share the one read in progress rather
    // than each reading the spreadsheet — and each finding the same months
    // unpinned
    if (!inFlight) {
        inFlight = refreshSnapshot().finally(() => {
            inFlight = null;
        });
    }

    return inFlight;
}

async function refreshSnapshot(): Promise<MetricsSnapshot> {
    // Outside the try: a missing env var is a misconfiguration to shout
    // about, not a network blip a stale snapshot should paper over
    const id = spreadsheetId();

    try {
        const accessToken = await getServiceAccountAccessToken();

        const rateRows = await readRateRows(accessToken, id);

        const snapshot: MetricsSnapshot = {
            rates: parseRates(rateRows),
            fetchedAt: new Date().toISOString(),
            stale: false,
            spreadsheetId: id,
        };

        cache = { snapshot, readAt: Date.now() };

        return snapshot;
    } catch (error) {
        if (!cache) throw error;

        console.warn(`[metrics] logbook refresh failed, serving the snapshot read at ${cache.snapshot.fetchedAt}: ${reason(error)}`);

        return { ...cache.snapshot, stale: true };
    }
}

// One creation attempt per instance: the tab exists after the first heal,
// and asking Google to add it again costs a round trip and a 400
let ratesTabReady: Promise<void> | null = null;

async function createRatesTab(): Promise<void> {
    const id = spreadsheetId();
    const accessToken = await getServiceAccountAccessToken();

    try {
        await sheetsFetch(accessToken, `${SHEETS_API}/${id}:batchUpdate`, {
            method: "POST",
            body: JSON.stringify({ requests: [{ addSheet: { properties: { title: RATES_SHEET } } }] }),
        });
    } catch (error) {
        // Every run after the first lands here; anything else is a real
        // failure the caller has to hear about
        if (!(error instanceof SheetsError && /already exists/i.test(error.message))) throw error;

        // The tab was already there — someone added it, or this instance is
        // simply cold. Its row 1 is not this app's to rewrite: it might be a
        // month pasted by hand, and a blind PUT would destroy it. Only a tab
        // with nothing on that row still wants the header, because the
        // parser reads row 1 as the header whatever it holds and the first
        // month appended into an empty tab would land there unread.
        const existing = await readValues(accessToken, id, RATES_SHEET, "A1:F1");

        if ((existing[0] ?? []).some((cell) => String(cell ?? "").trim() !== "")) return;
    }

    // Row 1 is the header by contract, on a tab this app just made or found empty
    await sheetsFetch(accessToken, `${rangeUrl(id, RATES_SHEET, "A1:F1")}?valueInputOption=RAW`, {
        method: "PUT",
        body: JSON.stringify({ values: [RATES_HEADER] }),
    });
}

/** Creates `MONTHLY RATES` with its header when the logbook has no such tab. */
export function ensureRatesTab(): Promise<void> {
    ratesTabReady ??= createRatesTab().catch((error: unknown) => {
        // A failed creation must not be remembered as done
        ratesTabReady = null;

        throw error;
    });

    return ratesTabReady;
}

/**
 * Pins rates by appending rows — never by writing a cell, so a month Claire
 * corrected by hand is not overwritten by the next request. RAW keeps the
 * numbers as numbers and the month as the text "2026-09".
 */
export async function appendRateRows(rows: RateRow[]): Promise<void> {
    if (!rows.length) return;

    const id = spreadsheetId();
    const accessToken = await getServiceAccountAccessToken();

    // The snapshot this request decided from can be ten minutes old, and the
    // seed script (or another instance) may have pinned some of these months
    // since — the tab is append-only, so the month column is read again at
    // the last moment and only the months still absent are written
    const pinned = new Set(
        (await readValues(accessToken, id, RATES_SHEET, "A:A")).map((row) => String(row[0] ?? "").trim()),
    );
    const missing = rows.filter((row) => !pinned.has(row.month));

    if (missing.length > 0) {
        await sheetsFetch(
            accessToken,
            `${rangeUrl(id, RATES_SHEET, "A1:F1")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
            {
                method: "POST",
                body: JSON.stringify({
                    values: missing.map((row) => [row.month, row.usdMzn, row.usdZar, row.source, row.pinnedOn ?? "", row.note ?? ""]),
                }),
            },
        );
    }

    // The cached snapshot is what the next request reads for up to ten
    // minutes; without this patch the same months would be fetched from the
    // feed and appended a second time
    if (cache) {
        cache.snapshot = { ...cache.snapshot, rates: [...cache.snapshot.rates, ...rows] };
    }
}
