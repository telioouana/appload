import { getTranslations } from "@workspace/i18n/server";

import { ForgotPasswordView } from "@/frontend/pages/sign-in/forgot-password-view";

export async function generateMetadata() {
    const t = await getTranslations("Admin.auth");

    return { title: t("forgot.title") };
}

export default function ForgotPassword() {
    return <ForgotPasswordView />
}
