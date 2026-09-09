import { Suspense } from "react";

import { getTranslations } from "@workspace/i18n/server";

import { VerifyEmailView } from "@/frontend/pages/auth/verify-email-view";

export async function generateMetadata() {
    const t = await getTranslations("App.auth");

    return { title: t("verify.title") };
}

export default function VerifyEmail() {
    return (
        // useSearchParams in VerifyEmailView requires a Suspense boundary for prerendering
        <Suspense>
            <VerifyEmailView />
        </Suspense>
    )
}
