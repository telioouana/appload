import { z } from "zod";

import { useTranslations } from "@workspace/i18n";
import { toE164 } from "@workspace/ui/lib/phone";

type SettingsTranslator = ReturnType<typeof useTranslations<"Admin.settings">>;

/**
 * The account and security forms. Every one of these is submitted straight
 * to Better Auth from the client — there is no tRPC procedure behind them —
 * so these schemas are the only client-side validation, and the server's own
 * checks (password strength, TOTP validity) are what actually decide.
 */

export function ProfileSchema(t: SettingsTranslator) {
    return z.object({
        name: z.string().nonempty({ error: t("account.name.error") }),
        // The avatar is uploaded by FileInput before submit, so the form
        // value is the resulting EdgeStore URL, never the File itself
        image: z.string().optional(),
    });
}

export type ProfileForm = z.infer<ReturnType<typeof ProfileSchema>>;

export function PasswordSchema(t: SettingsTranslator) {
    return z
        .object({
            currentPassword: z.string().nonempty({ error: t("password.current.error") }),
            // Better Auth's default minimum is 8; stated here so the user is
            // told before the round trip rather than by a server error
            newPassword: z.string().min(8, { error: t("password.new.error") }),
            confirmPassword: z.string().nonempty({ error: t("password.confirm.error") }),
            // Signing other sessions out is the safe default after a
            // credential change, but it stays the user's choice
            revokeOtherSessions: z.boolean(),
        })
        .refine((data) => data.newPassword === data.confirmPassword, {
            error: t("password.confirm.mismatch"),
            path: ["confirmPassword"],
        });
}

export type PasswordForm = z.infer<ReturnType<typeof PasswordSchema>>;

/**
 * The *first* password on an account that has only ever used Google. There is
 * no current password to confirm, so this is `PasswordSchema` minus that
 * field. Submitted through `settings.setPassword`, not `authClient` — Better
 * Auth's `setPassword` is a server-only endpoint.
 */
export function SetPasswordSchema(t: SettingsTranslator) {
    return z
        .object({
            newPassword: z.string().min(8, { error: t("methods.password.new.error") }),
            confirmPassword: z.string().nonempty({ error: t("methods.password.confirm.error") }),
        })
        .refine((data) => data.newPassword === data.confirmPassword, {
            error: t("methods.password.confirm.mismatch"),
            path: ["confirmPassword"],
        });
}

export type SetPasswordForm = z.infer<ReturnType<typeof SetPasswordSchema>>;

// Enabling and disabling both re-ask for the password: Better Auth requires
// it, and it stops a borrowed session from turning 2FA off.
export function TwoFactorPasswordSchema(t: SettingsTranslator) {
    return z.object({
        password: z.string().nonempty({ error: t("twoFactor.password.error") }),
    });
}

export type TwoFactorPasswordForm = z.infer<ReturnType<typeof TwoFactorPasswordSchema>>;

export function TotpCodeSchema(t: SettingsTranslator) {
    return z.object({
        code: z.string().length(6, { error: t("twoFactor.code.error") }),
    });
}

export type TotpCodeForm = z.infer<ReturnType<typeof TotpCodeSchema>>;

export function PhoneSchema(t: SettingsTranslator) {
    return z
        .object({
            // `PhoneInput` keeps the dial code beside the field rather than in
            // its value, so the country is a sibling field and the value is
            // the national number. `toE164` folds them back together.
            country: z.string().nonempty({ error: t("phone.number.country") }),
            phoneNumber: z.string().nonempty({ error: t("phone.number.error") }),
        })
        // E.164 is still the contract — the order form and the tracking jobs
        // dial what is stored — it is just validated on the composed value
        .refine((data) => z.e164().safeParse(toE164(data.country, data.phoneNumber)).success, {
            error: t("phone.number.error"),
            path: ["phoneNumber"],
        });
}

export type PhoneForm = z.infer<ReturnType<typeof PhoneSchema>>;

export function PhoneCodeSchema(t: SettingsTranslator) {
    return z.object({
        code: z.string().length(6, { error: t("phone.code.error") }),
    });
}

export type PhoneCodeForm = z.infer<ReturnType<typeof PhoneCodeSchema>>;
