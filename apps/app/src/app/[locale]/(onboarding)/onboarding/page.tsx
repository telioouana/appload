import { getTranslations } from "@workspace/i18n/server";

import { OnboardingView } from "@/frontend/pages/onboarding/views/onboarding-view";

export async function generateMetadata() {
    const t = await getTranslations("App.onboarding");

    return { title: t("title") };
}

export default function Onboarding() {
    return <OnboardingView />
}
