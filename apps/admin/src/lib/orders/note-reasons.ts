import { z } from "zod";

import { DEMURRAGE_STAGE, NOTE_REASON, type NoteDetails, type NoteReason, type Order } from "@workspace/db/orders";

/**
 * Structured causes of debit/credit notes and what they do to the order.
 * Client-safe and pure: the DocumentsCard uses the vocabulary and the
 * requirement checks, the documents router uses the order patch.
 */

export { NOTE_REASON, DEMURRAGE_STAGE };

/** Reasons that need particulars beyond the description */
export const DEMURRAGE: NoteReason = "demurrage";
export const DAMAGE: NoteReason = "damage";

/** The description is what explains an "other" note; every named reason can stand alone */
export const descriptionRequired = (reason: NoteReason): boolean => reason === "other";

/** Demurrage always names the stage and the days charged — those set the order */
export const demurrageFieldsComplete = (details: NoteDetails | undefined): details is NoteDetails & { stage: NonNullable<NoteDetails["stage"]>; days: number } =>
    details !== undefined && details.stage !== undefined && Number.isInteger(details.days) && (details.days ?? 0) >= 1;

export const noteDetailsSchema = z.object({
    stage: z.enum(DEMURRAGE_STAGE).optional(),
    days: z.number().int().min(1).max(365).optional(),
    damagedPercent: z.number().min(0).max(100).optional(),
    claimed: z.boolean().optional(),
});

/** Order columns a demurrage note writes, per stage */
const DEMURRAGE_COLUMNS = {
    loading: { charged: "demurrageChargedAtLoading", days: "demurrageChargedDaysAtLoading" },
    offloading: { charged: "demurrageChargedAtOffloading", days: "demurrageChargedDaysAtOffloading" },
    border: { charged: "demurrageChargedAtBorder", days: "demurrageChargedDaysAtBorder" },
} as const;

export type NoteOrderPatch = Partial<Pick<
    Order,
    | "demurrageChargedAtLoading" | "demurrageChargedDaysAtLoading"
    | "demurrageChargedAtOffloading" | "demurrageChargedDaysAtOffloading"
    | "demurrageChargedAtBorder" | "demurrageChargedDaysAtBorder"
    | "cargoDamaged" | "damagedPercent" | "claimed"
>>;

/**
 * What the order row learns from a note. Demurrage sets (not adds) the
 * charged flag and days for its stage — the form is prefilled with the
 * current days so a second note at the same stage shows what is there.
 * Damage marks the cargo damaged and records the share/claim when given.
 * Every other reason leaves the order alone.
 */
export function noteOrderPatch(reason: NoteReason, details: NoteDetails | undefined): NoteOrderPatch {
    if (reason === DEMURRAGE && demurrageFieldsComplete(details)) {
        const columns = DEMURRAGE_COLUMNS[details.stage];
        return { [columns.charged]: true, [columns.days]: details.days };
    }

    if (reason === DAMAGE) {
        return {
            cargoDamaged: true,
            ...(details?.damagedPercent !== undefined && { damagedPercent: String(details.damagedPercent) }),
            ...(details?.claimed !== undefined && { claimed: details.claimed }),
        };
    }

    return {};
}
