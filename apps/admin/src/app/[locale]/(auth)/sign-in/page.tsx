import { Suspense } from "react";

import { getTranslations } from "@workspace/i18n/server";

import { SignInView } from "@/frontend/pages/sign-in/sign-in-view";

export async function generateMetadata() {
    const t = await getTranslations("Admin.auth");

    return { title: t("sign-in") };
}

export default function SignIn() {
    return (
        // useSearchParams in SignInView requires a Suspense boundary for prerendering
        <Suspense>
            <SignInView />
        </Suspense>
    )
}
