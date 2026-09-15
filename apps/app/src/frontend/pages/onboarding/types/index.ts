import { z } from "zod";

import type { useTranslations } from "@workspace/i18n";

type OnboardingTranslator = ReturnType<typeof useTranslations<"App.onboarding">>;

type MessageField =
    | "name"
    | "nuit"
    | "email"
    | "phone"
    | "billingAddress"
    | "physicalAddress";

type ErrorParam = { error: string } | undefined;

/** Mozambican NUITs are 9 digits — the key the whole lookup turns on. */
export const NUIT_RE = /^\d{9}$/;

export const NuitBaseSchema = z.object({ nuit: z.string().regex(NUIT_RE) });

export function NuitSchema(t: OnboardingTranslator) {
    return z.object({
        nuit: z.string().regex(NUIT_RE, { error: t("nuit.error") }),
    });
}

export type NuitForm = z.infer<typeof NuitBaseSchema>;

/**
 * Addresses are optional here — a partner registering itself is not asked
 * for paperwork it may not have to hand. The form keeps the four fields as
 * (possibly empty) strings, the shape LocationInput writes and
 * react-hook-form can seed, so "empty" is a blank address rather than a
 * missing object; a half-filled one (text typed, no suggestion picked) is
 * what the refinement rejects. The procedure folds the rest through
 * AddressSchema (@workspace/db/types) and stores a blank address as null.
 * Mirrors src/backend/schemas/company.ts.
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
        name: z.string().nonempty(msg("name")),
        nuit: z.string().regex(NUIT_RE, msg("nuit")),
        // Optional: left empty, the company inherits the owner's own
        // verified address
        email: z
            .string()
            .refine((value) => !value || z.email().safeParse(value).success, msg("email"))
            .optional(),
        phone: z.string().min(9, msg("phone")),
        billingAddress: optionalLocation(msg("billingAddress")),
        physicalAddress: optionalLocation(msg("physicalAddress")),
    });
}

// Message-free variant used by the tRPC procedure to validate input
export const CreateCompanyBaseSchema = buildSchema(() => undefined);

export type CreateCompanyForm = z.infer<typeof CreateCompanyBaseSchema>;

// Client-side variant with translated error messages
export function CreateCompanySchema(t: OnboardingTranslator) {
    return buildSchema((field) => ({ error: t(`create.fields.${field}.error`) }));
}
