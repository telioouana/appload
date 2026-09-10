import type { MapEntity } from "@/frontend/pages/map/types"

/**
 * The map filters in the browser: the overview is one small array the page
 * already holds, so a search never costs a round-trip and the pins can be
 * dimmed rather than removed — a partner looking for one truck still sees
 * where the others are.
 */

// Accent- and case-insensitive: "joao" finds "João", "beira" finds "Beira"
export const normalizeQuery = (value: string) =>
    value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim()

// Plates are written "ABC-123-MP", "ABC 123 MP" or "ABC123MP" depending on
// who typed them; compare on letters and digits only, on both sides
const plateKey = (value: string) => normalizeQuery(value).replace(/[^a-z0-9]/g, "")

export function matchesEntity(entity: MapEntity, query: string): boolean {
    const term = normalizeQuery(query)

    if (!term) return true

    const fields = [entity.ref, entity.counterpartyName, entity.driverName]

    if (fields.some((field) => field && normalizeQuery(field).includes(term))) return true

    const plate = plateKey(term)

    return plate.length > 0 && !!entity.truckPlate && plateKey(entity.truckPlate).includes(plate)
}
