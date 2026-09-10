import { z } from "zod";

import { useTranslations } from "@workspace/i18n";
import { toE164 } from "@workspace/ui/lib/phone";

type DriverTranslator = ReturnType<typeof useTranslations<"App.drivers">>;

type MessageField = "name" | "email" | "phone" | "country";

type ErrorParam = { error: string } | undefined;

/**
 * A driver is a user account (the driver row references it), so registration
 * collects the account identity. The phone is stored in E.164 because it is
 * what the tracking jobs dial and what the order form's contact field
 * validates.
 *
 * The email is optional here, unlike in Admin: most Mozambican drivers have
 * none, and the procedure stands one in (`driver-<digits>@appload.invalid`)
 * so the account can still be created. The driver replaces it later.
 */
function buildSchema(msg: (field: MessageField) => ErrorParam) {
    return z.object({
        name: z.string().trim().nonempty(msg("name")),
        phoneNumber: z.e164(msg("phone")),
        email: z.email(msg("email")).optional(),
        passport: z.string().trim().max(40).optional(),
    });
}

// Message-free variant used by the tRPC procedure to validate input
export const RegisterDriverBaseSchema = buildSchema(() => undefined);

export type RegisterDriverInput = z.infer<typeof RegisterDriverBaseSchema>;

/**
 * The client-side shape. `PhoneInput` renders the dial code beside the field
 * and never folds it into the value, so the country travels as a sibling
 * field and `toE164` composes the two at submit — which is also what the
 * refinement validates and what the mutation is handed.
 */
function buildFormSchema(msg: (field: MessageField) => ErrorParam) {
    return z
        .object({
            name: z.string().trim().nonempty(msg("name")),
            country: z.string().nonempty(msg("country")),
            phoneNumber: z.string().nonempty(msg("phone")),
            // Empty means "no email"; the procedure stands a placeholder in
            email: z.union([z.literal(""), z.email(msg("email"))]),
            passport: z.string().trim().max(40),
        })
        .refine((data) => z.e164().safeParse(toE164(data.country, data.phoneNumber)).success, {
            ...(msg("phone") ?? {}),
            path: ["phoneNumber"],
        });
}

export function RegisterDriverSchema(t: DriverTranslator) {
    return buildFormSchema((field) => ({ error: t(`register.errors.validation.${field}`) }));
}

export type RegisterDriverForm = z.infer<ReturnType<typeof RegisterDriverSchema>>;

/** The same fields, reused by the edit dialog (which patches dirty ones only). */
export function EditDriverSchema(t: DriverTranslator) {
    return buildFormSchema((field) => ({ error: t(`register.errors.validation.${field}`) }));
}

export type EditDriverForm = RegisterDriverForm;
