import { OrderError } from "./errors";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

function spreadsheetId(): string {
    const id = process.env.GOOGLE_SHEETS_ORDERS_SPREADSHEET_ID;

    if (!id) {
        throw new OrderError("UNKNOWN", "GOOGLE_SHEETS_ORDERS_SPREADSHEET_ID is not set");
    }

    return id;
}

async function sheetsFetch(accessToken: string, path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${SHEETS_API}/${spreadsheetId()}${path}`, {
        ...init,
        headers: {
            ...init?.headers,
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
    });

    if (response.status === 401 || response.status === 403) {
        if (process.env.NEXT_PUBLIC_GOOGLE_SHEETS_AUTH_MODE === "service-account") {
            // Nothing the signed-in user can fix: the service account is not
            // an editor of the spreadsheet (or the key is stale)
            throw new OrderError(
                "SHEET_FAILED",
                `Sheets API responded ${response.status}: the service account has no editor access to spreadsheet ${spreadsheetId()}`,
            );
        }

        // Token lacks the spreadsheets scope (linked before the scope change)
        // or the signed-in Google account cannot edit this spreadsheet
        throw new OrderError("INSUFFICIENT_SCOPE", `Sheets API responded ${response.status}`);
    }

    if (!response.ok) {
        throw new OrderError("SHEET_FAILED", `Sheets API responded ${response.status}: ${await response.text()}`);
    }

    return response.json();
}

const range = (sheet: string, a1: string) => `'${sheet}'!${a1}`;
const encodedRange = (sheet: string, a1: string) => encodeURIComponent(range(sheet, a1));

export async function getRange(accessToken: string, sheet: string, a1: string): Promise<string[][]> {
    const data = (await sheetsFetch(accessToken, `/values/${encodedRange(sheet, a1)}`)) as { values?: string[][] };
    return data.values ?? [];
}

/**
 * Same as getRange but formula cells come back as their formula text
 * ("=ORDERS[...]..."), which is how the sync tells a formula-owned cell from
 * a value. Non-formula cells are returned as entered (numbers as numbers),
 * so everything is stringified.
 */
export async function getRangeFormulas(accessToken: string, sheet: string, a1: string): Promise<string[][]> {
    const data = (await sheetsFetch(
        accessToken,
        `/values/${encodedRange(sheet, a1)}?valueRenderOption=FORMULA`,
    )) as { values?: unknown[][] };

    return (data.values ?? []).map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
}

export const isFormula = (cell: string | undefined) => typeof cell === "string" && cell.startsWith("=");

export async function appendRow(accessToken: string, sheet: string, anchor: string, row: (string | null)[]): Promise<void> {
    await sheetsFetch(
        accessToken,
        `/values/${encodedRange(sheet, anchor)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        {
            method: "POST",
            body: JSON.stringify({ values: [row] }),
        },
    );
}

/**
 * Writes one row A..lastColumn. A null cell is skipped by the API (the
 * cell keeps whatever it holds — value, formula or hand-entered text); ""
 * clears it.
 */
export async function updateRow(
    accessToken: string,
    sheet: string,
    rowIndex: number,
    lastColumn: string,
    row: (string | null)[],
): Promise<void> {
    await sheetsFetch(
        accessToken,
        `/values/${encodedRange(sheet, `A${rowIndex}:${lastColumn}${rowIndex}`)}?valueInputOption=USER_ENTERED`,
        {
            method: "PUT",
            body: JSON.stringify({ values: [row] }),
        },
    );
}

/**
 * One horizontal run of cells within a single row, e.g. { a1: "M5:N5",
 * values: ["490", "14 Jan 2026"] }. A null cell is skipped by the API
 * (nothing written), which is how formula/hand-entered cells survive.
 */
export type CellRun = {
    a1: string;
    values: (string | null)[];
};

export async function batchUpdateCells(accessToken: string, sheet: string, runs: CellRun[]): Promise<void> {
    if (runs.length === 0) {
        return;
    }

    await sheetsFetch(accessToken, `/values:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({
            valueInputOption: "USER_ENTERED",
            data: runs.map((run) => ({
                range: range(sheet, run.a1),
                values: [run.values],
            })),
        }),
    });
}

/** Returns the 1-based sheet row index whose "Order Id" cell matches, or null. */
export async function findRowByOrderId(accessToken: string, sheet: string, orderId: string): Promise<number | null> {
    const column = await getRange(accessToken, sheet, "A:A");
    const index = column.findIndex((cells) => cells[0]?.trim() === orderId);

    return index === -1 ? null : index + 1;
}

export type SheetTable = {
    sheetId: number;
    tableId: string;
    name: string;
};

type SpreadsheetTablesResponse = {
    sheets?: {
        properties?: { sheetId?: number; title?: string };
        tables?: { tableId?: string; name?: string }[];
    }[];
};

// Table ids never change for the life of a spreadsheet: one lookup per
// spreadsheet per process
const tableCache = new Map<string, SheetTable | null>();

/**
 * The Google Sheets Table (the structured "Convert to table" kind) named
 * `tableName` on the tab `sheet`, or null when the tab holds plain cells.
 */
export async function findSheetTable(accessToken: string, sheet: string, tableName: string): Promise<SheetTable | null> {
    const cacheKey = `${spreadsheetId()}/${sheet}/${tableName}`;
    const cached = tableCache.get(cacheKey);

    if (cached !== undefined) {
        return cached;
    }

    const data = (await sheetsFetch(
        accessToken,
        `?fields=${encodeURIComponent("sheets(properties(sheetId,title),tables(tableId,name))")}`,
    )) as SpreadsheetTablesResponse;

    let found: SheetTable | null = null;

    for (const entry of data.sheets ?? []) {
        if (entry.properties?.title !== sheet || entry.properties.sheetId === undefined) continue;

        const table = entry.tables?.find((candidate) => candidate.name === tableName) ?? entry.tables?.[0];

        if (table?.tableId) {
            found = { sheetId: entry.properties.sheetId, tableId: table.tableId, name: table.name ?? tableName };
        }
    }

    tableCache.set(cacheKey, found);

    return found;
}

/**
 * Appends one row to the BODY of a Sheets Table (the table grows to hold
 * it, so structured-reference formulas, dropdown validation and banding
 * all apply to the new row). Only plain strings are written here; the
 * caller follows up with a full-row update.
 */
export async function appendTableRow(accessToken: string, table: SheetTable, cells: string[]): Promise<void> {
    await sheetsFetch(accessToken, `:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({
            requests: [
                {
                    appendCells: {
                        sheetId: table.sheetId,
                        tableId: table.tableId,
                        rows: [{ values: cells.map((value) => ({ userEnteredValue: { stringValue: value } })) }],
                        fields: "userEnteredValue",
                    },
                },
            ],
        }),
    });
}
