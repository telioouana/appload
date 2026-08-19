import { z } from "zod";
import type { useTranslations } from "@workspace/i18n";

type AuthTranslator = ReturnType<typeof useTranslations<"Admin.auth">>;

export function ForgotPasswordSchema(t: AuthTranslator) {
    return z.object({
        username: z.string().nonempty({ error: t("username.error") }),
    });
}

export type ForgotPasswordForm = z.infer<ReturnType<typeof ForgotPasswordSchema>>;

// Mirrors SetPasswordSchema in ./settings.ts: Better Auth's default minimum
// is 8, stated here so the user is told before the round trip
export function ResetPasswordSchema(t: AuthTranslator) {
    return z
        .object({
            newPassword: z.string().min(8, { error: t("reset.password.error") }),
            confirmPassword: z.string().nonempty({ error: t("reset.confirm.error") }),
        })
        .refine((data) => data.newPassword === data.confirmPassword, {
            error: t("reset.confirm.mismatch"),
            path: ["confirmPassword"],
        });
}

export type ResetPasswordForm = z.infer<ReturnType<typeof ResetPasswordSchema>>;
