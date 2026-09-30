import { z } from "zod"

import type { ContractBasis, PriceModel } from "@/frontend/pages/contracts/types"

/**
 * A price model as a form holds it: one flat block per leg, every amount a
 * string as typed, and "none" for no price. `toPriceModel` turns it into the
 * jsonb union the doors validate; `fromPriceModel` the other way round.
 */
export const PRICE_FORM_MODELS = ["none", "per-trip", "per-ton", "per-day", "lump-sum"] as const
export type PriceFormModel = (typeof PRICE_FORM_MODELS)[number]

export type PriceForm = {
    model: PriceFormModel
    rate: string
    minBillableTons: string
    billableDays: "calendar" | "working"
    total: string
}

export const EMPTY_PRICE: PriceForm = { model: "none", rate: "", minBillableTons: "", billableDays: "calendar", total: "" }

/** The models that can price what a contract counts (apply.ts says the same server-side). */
export const modelsFor = (basis: ContractBasis): PriceFormModel[] =>
    basis === "days" ? ["none", "per-day", "lump-sum"] : ["none", "per-trip", "per-ton", "lump-sum"]

const num = (value: string): number => Number(value.trim())

export function toPriceModel(form: PriceForm): PriceModel | null {
    switch (form.model) {
        case "none":
            return null
        case "per-trip":
            return { model: "per-trip", rate: num(form.rate) }
        case "per-ton":
            return {
                model: "per-ton",
                rate: num(form.rate),
                ...(form.minBillableTons.trim() && { minBillableTons: num(form.minBillableTons) }),
            }
        case "per-day":
            return { model: "per-day", rate: num(form.rate), billableDays: form.billableDays }
        case "lump-sum":
            return { model: "lump-sum", total: num(form.total) }
    }
}

export function fromPriceModel(model: PriceModel | null): PriceForm {
    if (!model) return EMPTY_PRICE

    switch (model.model) {
        case "per-trip":
            return { ...EMPTY_PRICE, model: "per-trip", rate: String(model.rate) }
        case "per-ton":
            return { ...EMPTY_PRICE, model: "per-ton", rate: String(model.rate), minBillableTons: model.minBillableTons === undefined ? "" : String(model.minBillableTons) }
        case "per-day":
            return { ...EMPTY_PRICE, model: "per-day", rate: String(model.rate), billableDays: model.billableDays }
        case "lump-sum":
            return { ...EMPTY_PRICE, model: "lump-sum", total: String(model.total) }
    }
}

const positive = (value: string) => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 1e12
const nonNegativeOrEmpty = (value: string) => value.trim() === "" || (Number.isFinite(Number(value)) && Number(value) >= 0)

/** The block's own rules: the amount the chosen model needs has to be there, and positive. */
export function PriceFormSchema(message: string) {
    return z
        .object({
            model: z.enum(PRICE_FORM_MODELS),
            rate: z.string(),
            minBillableTons: z.string().refine(nonNegativeOrEmpty, message),
            billableDays: z.enum(["calendar", "working"]),
            total: z.string(),
        })
        .superRefine((value, ctx) => {
            if (value.model === "lump-sum" && !positive(value.total)) {
                ctx.addIssue({ code: "custom", message, path: ["total"] })
            }
            if ((value.model === "per-trip" || value.model === "per-ton" || value.model === "per-day") && !positive(value.rate)) {
                ctx.addIssue({ code: "custom", message, path: ["rate"] })
            }
        })
}
