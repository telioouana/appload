import type { Location } from "@workspace/db/orders"

import type { Currency } from "@/frontend/pages/orders/types"

/** How a place reads in a cell: the province, or the first line of the address. */
export const place = (location: Location) =>
    location.state || location.address.split(",")[0]?.trim() || location.address

type Formatter = { number: (value: number, options?: Intl.NumberFormatOptions) => string }

/**
 * An amount next to its currency, as every money figure in the portal reads.
 * The tenant only ever receives its own leg, so there is no party to name.
 */
export const money = (
    f: Formatter,
    value: number | null,
    currency: Currency | null,
    fraction = 0,
) => (value === null ? null : `${f.number(value, { maximumFractionDigits: fraction })} ${currency ?? "MZN"}`)
