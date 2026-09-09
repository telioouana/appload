import { Suspense } from "react";

import { getTranslations } from "@workspace/i18n/server";

import { ResetPasswordView } from "@/frontend/pages/auth/reset-password-view";

export async function generateMetadata() {
    const t = await getTranslations("App.auth");

    return { title: t("reset.title") };
}

export default function ResetPassword() {
    return (
        // useSearchParams in ResetPasswordView requires a Suspense boundary for prerendering
        <Suspense>
            <ResetPasswordView />
        </Suspense>
    )
}
