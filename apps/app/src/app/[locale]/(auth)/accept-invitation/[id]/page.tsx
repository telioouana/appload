import { getTranslations } from "@workspace/i18n/server";

import { AcceptInvitationView } from "@/frontend/pages/auth/accept-invitation-view";

export async function generateMetadata() {
    const t = await getTranslations("App.auth");

    return { title: t("invitation.accept") };
}

export default async function AcceptInvitation({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;

    return <AcceptInvitationView invitationId={id} />
}
