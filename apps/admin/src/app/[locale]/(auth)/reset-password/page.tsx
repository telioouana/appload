import { Suspense } from "react";

import { getTranslations } from "@workspace/i18n/server";

import { ResetPasswordView } from "@/frontend/pages/sign-in/reset-password-view";

export async function generateMetadata() {
    const t = await getTranslations("Admin.auth");

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
