/**
 * The numbers Claire's KPI sheet computes with, in one place.
 *
 * Three quirks of the sheet are reproduced here on purpose rather than fixed,
 * so the page and the PDF print what the "SHIPPERS KPI's" / "CARRIERS KPI's"
 * tabs print:
 * - the CO₂ row is labelled "kg / ton transported" but its formula is a plain
 *   total (coefficient × tons × km × age × load) that is never divided by the
 *   tonnage — the label is the sheet's, the figure is the formula's;
 * - the shipper's backload savings are taken over *every* analysed trip
 *   (total ÷ SAVINGS_DIVISOR − total), not only the backload ones, even though
 *   the row sits in the backload block;
 * - fuel is priced in meticais (litres per km × MZN per litre) and only then
 *   converted at the trip's loading-day rate, which is what makes the carrier's
 *   fuel margin dimensionally sound here — the sheet compared a MZN cost with a
 *   total invoiced in whatever currency the trip used.
 */

/** Litres a loaded truck burns per kilometre, as the sheet assumes. */
export const FUEL_LITRES_PER_KM = 0.5;

/** Pump price the sheet puts on that fuel, meticais per litre. */
export const FUEL_PRICE_MZN_PER_LITRE = 86;

/** Backload savings: the share of the price the sheet assumes a backload trip costs. */
export const SAVINGS_DIVISOR = 0.7;

/** CO₂ multiplier for the truck's age, used when `age_factor` is empty (TRUCK_AGE keys). */
export const AGE_FACTOR = { recent: 1, "not-recent": 1.2 } as const;

/** CO₂ multiplier for how the truck was loaded, used when `load_factor` is empty (TRIP_TYPE keys). */
export const LOAD_FACTOR = { backload: 0.8, normal: 1 } as const;

/** CO₂ coefficient per ton-km, used when `default_coefficient` is empty (TRIP_TYPE keys). */
export const DEFAULT_COEFFICIENT = { backload: 0.03, normal: 0.12 } as const;
