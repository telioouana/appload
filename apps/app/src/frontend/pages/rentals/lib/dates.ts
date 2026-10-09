/** A rental's days are "YYYY-MM-DD" strings. They are local days: read at noon so the formatter's zone cannot slide them. */
export const localDate = (iso: string) => {
    const [year, month, day] = iso.split("-").map(Number)
    return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12)
}

/** The day a picked Date names, as the server stores it. */
export const isoOf = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

/** Today as the diary counts it — in Maputo, like the crons. */
export const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Maputo" }).format(new Date())
