import { z } from "zod";

import type { useTranslations } from "@workspace/i18n";

// The translator bound to the `App.auth` namespace, as returned by
// `useTranslations("App.auth")`. Keeps the schema's error keys type-checked
// against the message catalog.
type AuthTranslator = ReturnType<typeof useTranslations<"App.auth">>;

type MessageField = "email" | "password";

type ErrorParam = { error: string } | undefined;

// Partners sign in with their full work address — there is no company
// domain to fold a bare username into, as the admin does for staff
function buildSchema(msg: (field: MessageField) => ErrorParam) {
    return z.object({
        email: z.email(msg("email")),
        password: z.string().nonempty(msg("password")),
    });
}

// Message-free variant, for anything validating this input server-side
export const SignInBaseSchema = buildSchema(() => undefined);

export type SignInForm = z.infer<typeof SignInBaseSchema>;

// Client-side variant with translated error messages
export function SignInSchema(t: AuthTranslator) {
    return buildSchema((field) => ({ error: t(`${field}.error`) }));
}
