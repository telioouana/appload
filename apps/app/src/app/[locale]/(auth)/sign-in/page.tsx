import { Suspense } from "react";

import { getTranslations } from "@workspace/i18n/server";

import { firstParam, redirectIfSignedIn } from "@/lib/auth-redirect";
import { SignInView } from "@/frontend/pages/auth/sign-in-view";

export async function generateMetadata() {
    const t = await getTranslations("App.auth");

    return { title: t("sign-in") };
}

export default async function SignIn({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const params = await searchParams;

    await redirectIfSignedIn(firstParam(params.callbackUrl ?? params.callback));

    return (
        // useSearchParams in SignInView requires a Suspense boundary for prerendering
        <Suspense>
            <SignInView />
        </Suspense>
    )
}
