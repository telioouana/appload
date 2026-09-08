import { getTranslations } from "@workspace/i18n/server"

import { isInfobipConfigured } from "@/lib/chats/infobip"
import { ChatsView } from "@/frontend/pages/chats/views/chats-view"

export async function generateMetadata() {
    const t = await getTranslations("Admin.messages")

    return { title: t("title") }
}

export default function Messages() {
    // Server-derived so the operator sees, on the page itself, that sends
    // are simulated until Infobip is configured
    return <ChatsView configured={isInfobipConfigured()} />
}
