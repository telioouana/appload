import { z } from "zod";

import type { useTranslations } from "@workspace/i18n";

type AuthTranslator = ReturnType<typeof useTranslations<"App.auth">>;

type MessageField = "name" | "email" | "password" | "company-type";

type ErrorParam = { error: string } | undefined;

/**
 * Account creation. `companyType` decides `user.type`, which is what the
 * tenant gate reads — so the value is always re-derived server-side: from
 * this field for a plain sign-up, and from the inviting organization when
 * the form carries an invitation.
 *
 * The minimum password length mirrors Better Auth's own default (8), stated
 * here so the user is told before the round trip.
 */
function buildSchema(msg: (field: MessageField) => ErrorParam) {
    return z.object({
        name: z.string().nonempty(msg("name")),
        email: z.email(msg("email")),
        password: z.string().min(8, msg("password")),
        companyType: z.enum(["shipper", "carrier"], msg("company-type")),
    });
}

// Message-free variant used by the tRPC procedure to validate input
export const SignUpBaseSchema = buildSchema(() => undefined);

export type SignUpForm = z.infer<typeof SignUpBaseSchema>;

// Client-side variant with translated error messages
export function SignUpSchema(t: AuthTranslator) {
    return buildSchema((field) => ({ error: t(`sign-up.${field}.error`) }));
}
