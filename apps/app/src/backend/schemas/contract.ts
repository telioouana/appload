import { z } from "zod";

import type { ContractBasis, ContractStatus } from "@workspace/db/contracts";
import { CURRENCY, FISCAL_REGIME, PriceModelSchema, WEIGHT_UNIT } from "@workspace/db/types";

/**
 * What the contracts doors accept. The vocabularies are restated with
 * `satisfies` for the reason the movement schemas give: these ship in the
 * browser bundle, and `@workspace/db/contracts` builds tables at import.
 */
export const CONTRACT_BASIS = ["trips", "weight", "days"] as const satisfies readonly ContractBasis[];
export const CONTRACT_STATUS = ["draft", "active", "closed"] as const satisfies readonly ContractStatus[];

const NAME_MAX = 120;
const REFERENCE_MAX = 60;
const NOTES_MAX = 2000;

const text = (max: number) => z.string().trim().max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const quantity = z.number().finite().positive().max(1e9);

const location = z.object({
    address: z.string().nonempty(),
    placeId: z.string().nonempty(),
    country: z.string().nonempty(),
    state: z.string().nonempty(),
});

export const ContractInputSchema = z.object({
    basis: z.enum(CONTRACT_BASIS),
    /** A connected client, or a typed name; the server checks the connection */
    clientOrgId: z.string().nonempty().nullable().optional(),
    clientName: text(NAME_MAX).nullable().optional(),
    clientReference: text(REFERENCE_MAX).nullable().optional(),
    /** Both or neither: a contract on any lane names no places */
    origin: location.nullable().optional(),
    destination: location.nullable().optional(),
    startsOn: isoDate,
    endsOn: isoDate,
    committedQty: quantity,
    weightUnit: z.enum(WEIGHT_UNIT).nullable().optional(),
    currency: z.enum(CURRENCY),
    fiscalRegime: z.enum(FISCAL_REGIME).nullable().optional(),
    sellPrice: PriceModelSchema.nullable().optional(),
    notes: text(NOTES_MAX).nullable().optional(),
});

export type ContractInput = z.infer<typeof ContractInputSchema>;

const versioned = {
    id: z.string().nonempty(),
    expectedVersion: z.number().int().min(1),
};

export const UpdateContractSchema = ContractInputSchema.extend(versioned);

export const TransitionContractSchema = z.object({
    ...versioned,
    to: z.enum(CONTRACT_STATUS),
});

export const AllocationInputSchema = z.object({
    /** A connected transporter or Appload; null with no name is the owner's own fleet */
    carrierOrgId: z.string().nonempty().nullable().optional(),
    carrierName: text(NAME_MAX).nullable().optional(),
    shareQty: quantity,
    buyPrice: PriceModelSchema.nullable().optional(),
    truckId: z.string().nonempty().nullable().optional(),
    driverId: z.string().nonempty().nullable().optional(),
    truckPlate: text(REFERENCE_MAX).nullable().optional(),
    notes: text(NOTES_MAX).nullable().optional(),
});

export type AllocationInput = z.infer<typeof AllocationInputSchema>;

export const AddAllocationSchema = AllocationInputSchema.extend({ contractId: z.string().nonempty() });
export const UpdateAllocationSchema = AllocationInputSchema.extend({ id: z.string().nonempty() });

export const TripDefaultsSchema = z.object({
    allocationId: z.string().nonempty(),
    weight: z.number().finite().nonnegative().optional(),
    weightUnit: z.enum(WEIGHT_UNIT).optional(),
});

export const SetContractFileSchema = z.object({
    ...versioned,
    url: z.url().nullable(),
    name: text(NAME_MAX).nullable(),
});
