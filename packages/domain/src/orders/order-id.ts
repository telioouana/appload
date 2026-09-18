const ORDER_ID_PATTERN = /^APPL(\d+)\.(\d{2})$/;

/**
 * Full calendar year stored on the order row (the list filter queries it
 * as e.g. 2026); the Order Id suffix uses the two-digit form (".26").
 */
export const currentOrderYear = () => new Date().getFullYear();

export const formatOrderId = (seq: number, year: number) =>
    `APPL${String(seq).padStart(3, "0")}.${String(year % 100).padStart(2, "0")}`;

/** Highest sequence number found in the sheet's "Order Id" column for the given year. */
export function maxSheetSeq(orderIdColumn: string[][], year: number): number {
    let max = 0;

    for (const cells of orderIdColumn) {
        const match = cells[0]?.trim().match(ORDER_ID_PATTERN);

        if (match && Number(match[2]) === year % 100) {
            max = Math.max(max, Number(match[1]));
        }
    }

    return max;
}

/**
 * Next Order Id: continues from whichever is further ahead, the database
 * or the sheet (covers rows added to the sheet by hand). The database's
 * unique (year, seq) index is the final arbiter under concurrency.
 */
export function nextOrderId(dbMaxSeq: number, sheetMaxSeq: number, year: number) {
    const seq = Math.max(dbMaxSeq, sheetMaxSeq) + 1;

    return { orderId: formatOrderId(seq, year), seq, year };
}
