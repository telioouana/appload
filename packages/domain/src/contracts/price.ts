import type { ContractBasis } from "@workspace/db/contracts";
import type { PriceModel, WEIGHT_UNIT } from "@workspace/db/types";

type WeightUnit = (typeof WEIGHT_UNIT)[number];
export type BillableDays = "calendar" | "working";

const round = (value: number) => Math.round(value * 100) / 100;

/** A load's weight in tons, or null when it has none or is measured in litres. */
export const toTons = (weight: number | string | null, unit: WeightUnit | null): number | null => {
    if (weight === null || weight === undefined) return null;
    const value = Number(weight);
    if (!Number.isFinite(value)) return null;
    if (unit === "kg") return value / 1000;
    if (unit === "ton") return value;
    return null;
};

/**
 * What a contract's price model makes one trip worth, VAT included in the
 * contract's currency — the editable default the load is filed with, never
 * a ceiling. Null when the model cannot price a trip: a rental's money is on
 * the contract, and a per-ton price needs a weight.
 */
export function tripPrice(model: PriceModel | null, load: { weight: number | string | null; weightUnit: WeightUnit | null }): number | null {
    if (!model) return null;

    switch (model.model) {
        case "per-trip":
            return round(model.rate);
        case "per-ton": {
            const tons = toTons(load.weight, load.weightUnit);
            if (tons === null) return null;
            return round(model.rate * Math.max(tons, model.minBillableTons ?? 0));
        }
        case "per-day":
            return null;
        case "lump-sum":
            return 0;
    }
}

/** Today's date in Maputo as "YYYY-MM-DD", the calendar every period is read in. */
export const todayInMaputo = (at: Date = new Date()): string =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Maputo", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

const dayOf = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

/**
 * Days between two dates inclusive, both "YYYY-MM-DD". Working days are
 * Monday to Saturday, the week the crons keep. Zero when `to` is before
 * `from`.
 */
export function billableDays(from: string, to: string, mode: BillableDays): number {
    const start = dayOf(from);
    const end = dayOf(to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;

    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (mode === "calendar") return days;

    let working = 0;
    for (let i = 0; i < days; i++) {
        const weekday = new Date(start.getTime() + i * 86_400_000).getUTCDay();
        if (weekday !== 0) working += 1;
    }
    return working;
}

/** The unit a contract's quantities are in. */
export const unitOf = (basis: ContractBasis): "trip" | "ton" | "day" =>
    basis === "weight" ? "ton" : basis === "days" ? "day" : "trip";

/**
 * What a whole commitment is worth under a price model, or null when the
 * model does not say (a per-ton price × a tonnage does; a per-trip price ×
 * a tonnage does not).
 */
export function commitmentValue(model: PriceModel | null, basis: ContractBasis, qty: number | null): number | null {
    if (!model || qty === null) return null;

    switch (model.model) {
        case "lump-sum":
            return round(model.total);
        case "per-trip":
            return basis === "trips" ? round(model.rate * qty) : null;
        case "per-ton":
            return basis === "weight" ? round(model.rate * qty) : null;
        case "per-day":
            return basis === "days" ? round(model.rate * qty) : null;
    }
}

/**
 * What the drawn-down part of a commitment comes to: the rate times the
 * quantity taken, or the lump sum's share of it. Zero on an open lump sum,
 * which has nothing to take a share of.
 */
export function consumedValue(model: PriceModel | null, basis: ContractBasis, committed: number | null, consumed: number): number | null {
    if (!model) return null;
    if (model.model === "lump-sum") return committed ? round(model.total * Math.min(consumed / committed, 1)) : 0;

    return commitmentValue(model, basis, consumed);
}

// node --import tsx packages/domain/src/contracts/price.ts — the arithmetic
// the trips and the strip are priced with, checked on its own
if (process.argv[1]?.endsWith("price.ts")) {
    const eq = (name: string, got: unknown, want: unknown) => {
        if (got !== want) throw new Error(`${name}: got ${String(got)}, want ${String(want)}`);
    };
    eq("per-trip", tripPrice({ model: "per-trip", rate: 45_000 }, { weight: null, weightUnit: null }), 45_000);
    eq("per-ton", tripPrice({ model: "per-ton", rate: 1_500 }, { weight: "30", weightUnit: "ton" }), 45_000);
    eq("per-ton kg", tripPrice({ model: "per-ton", rate: 1_500 }, { weight: 30_000, weightUnit: "kg" }), 45_000);
    eq("per-ton floor", tripPrice({ model: "per-ton", rate: 1_500, minBillableTons: 30 }, { weight: 20, weightUnit: "ton" }), 45_000);
    eq("per-ton no weight", tripPrice({ model: "per-ton", rate: 1_500 }, { weight: null, weightUnit: null }), null);
    eq("per-day", tripPrice({ model: "per-day", rate: 9_000, billableDays: "working" }, { weight: null, weightUnit: null }), null);
    eq("lump-sum", tripPrice({ model: "lump-sum", total: 1_000_000 }, { weight: 30, weightUnit: "ton" }), 0);
    // 2026-09-28 is a Monday: Mon–Sun inclusive is 7 calendar days, 6 working
    eq("calendar", billableDays("2026-09-28", "2026-10-04", "calendar"), 7);
    eq("working", billableDays("2026-09-28", "2026-10-04", "working"), 6);
    eq("reversed", billableDays("2026-10-04", "2026-09-28", "calendar"), 0);
    eq("value", commitmentValue({ model: "per-ton", rate: 1_500 }, "weight", 2_000), 3_000_000);
    eq("value mismatch", commitmentValue({ model: "per-trip", rate: 45_000 }, "weight", 2_000), null);
    eq("drawn", consumedValue({ model: "per-ton", rate: 1_500 }, "weight", 2_000, 300), 450_000);
    eq("drawn lump sum", consumedValue({ model: "lump-sum", total: 1_000 }, "trips", 4, 1), 250);
    eq("drawn open lump sum", consumedValue({ model: "lump-sum", total: 1_000 }, "trips", null, 1), 0);
    console.log("ok");
}
