/**
 * Builds a CSV in the browser and hands it to the user as a download. A
 * spreadsheet is what the ops team actually wants from "export", and the
 * rows are already on the client, so no server route is needed.
 */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
    const escape = (value: string | number | null | undefined) => {
        const text = value === null || value === undefined ? "" : String(value)
        return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text
    }

    const body = [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n")
    // The BOM makes Excel read the UTF-8 accents (Moçambique, Zambézia) correctly
    const blob = new Blob([`﻿${body}`], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)

    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    anchor.click()

    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** yyyy-mm-dd for a file name. */
export const stamp = () => new Date().toISOString().slice(0, 10)
