import { z } from "zod";
import type { useTranslations } from "@workspace/i18n";

// The translator bound to the `Admin.auth` namespace, as returned by
// `useTranslations("Admin.auth")`. Keeps the schema's error keys type-checked
// against the message catalog.
type AuthTranslator = ReturnType<typeof useTranslations<"Admin.auth">>;

// Kept apart from @workspace/auth/server's STAFF_EMAIL_DOMAIN on purpose:
// importing that module pulls the database into the client bundle. The
// sign-in form shows this suffix beside the username field, so a bare
// username means "this domain".
export const STAFF_EMAIL_DOMAIN = "apploadafrica.com";

/**
 * Folds a bare username into a full staff address. A value that already
 * carries an `@` is passed through untouched — a defensive no-op for callers
 * outside the forms, which now refuse anything but a bare username.
 */
export function staffEmail(username: string): string {
    const trimmed = username.trim();
    return trimmed.includes("@") ? trimmed : `${trimmed}@${STAFF_EMAIL_DOMAIN}`;
}

export function SignInSchema(t: AuthTranslator) {
    return (
        z.object({
            // A bare staff username: the staff domain is the only one that
            // signs in here, so an address typed in full is refused rather
            // than quietly accepted by `staffEmail`
            username: z
                .string()
                .nonempty({ error: t("username.error") })
                .regex(/^[^@\s]+$/, { error: t("username.invalid") }),
            password: z.string().nonempty({ error: t("password.error") }),
        })
    )
}
