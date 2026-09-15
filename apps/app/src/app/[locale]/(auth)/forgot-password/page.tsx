import { getTranslations } from "@workspace/i18n/server";

import { redirectIfSignedIn } from "@/lib/auth-redirect";

import { ForgotPasswordView } from "@/frontend/pages/auth/forgot-password-view";

export async function generateMetadata() {
    const t = await getTranslations("App.auth");

    return { title: t("forgot.title") };
}

export default async function ForgotPassword() {
    await redirectIfSignedIn();

    return <ForgotPasswordView />
}
