import { z } from "zod";

import { useTranslations } from "@workspace/i18n";

type SettingsTranslator = ReturnType<typeof useTranslations<"App.settings">>;

type MessageField = "email" | "phone" | "billingAddress" | "physicalAddress";

type ErrorParam = { error: string } | undefined;

/**
 * The company's own contact block. Name and NUIT are not here: the portal
 * shows them read-only, because Appload's registry, the logbook and every
 * issued document are keyed on them.
 *
 * The addresses are optional and kept as four (possibly empty) strings, the
 * shape `LocationInput` writes and react-hook-form can seed. A half-filled
 * one — text typed, no suggestion picked — is what the refinement rejects;
 * the procedure folds the rest through `AddressSchema` (@workspace/db/types),
 * which is what decides whether a complete address was stored or null.
 */
const optionalLocation = (error?: ErrorParam) => z
    .object({
        address: z.string(),
        placeId: z.string(),
        country: z.string(),
        state: z.string(),
    })
    .partial()
    .refine(
        (value) => !value.address || Boolean(value.placeId && value.country && value.state),
        { ...(error ?? {}), path: ["address"] },
    );

function buildSchema(msg: (field: MessageField) => ErrorParam) {
    return z.object({
        email: z.email(msg("email")),
        phoneNumber: z.string().min(9, msg("phone")),
        billingAddress: optionalLocation(msg("billingAddress")),
        physicalAddress: optionalLocation(msg("physicalAddress")),
    });
}

/**
 * Message-free variant used by `me.updateCompany`. Every field is optional:
 * the mutation is a patch, and only what it is given is written.
 */
export const UpdateCompanyBaseSchema = buildSchema(() => undefined).partial();

export type UpdateCompanyPatch = z.infer<typeof UpdateCompanyBaseSchema>;

// Client-side variant with translated error messages. The form always sends
// all four fields, so email and phone stay required here.
export function UpdateCompanySchema(t: SettingsTranslator) {
    return buildSchema((field) => ({ error: t(`company.fields.${field}.error`) }));
}

export type UpdateCompanyForm = z.infer<ReturnType<typeof UpdateCompanySchema>>;
