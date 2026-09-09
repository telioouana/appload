import { getTranslations } from "@workspace/i18n/server";

import { SignUpView } from "@/frontend/pages/auth/sign-up-view";

export async function generateMetadata() {
    const t = await getTranslations("App.auth");

    return { title: t("sign-up.title") };
}

export default function SignUp() {
    return <SignUpView />
}
