import { isInfobipConfigured } from "@/lib/chats/infobip"
import { ChatsView } from "@/frontend/pages/chats/views/chats-view"

export default function Chats() {
    // Server-derived so the operator sees, on the page itself, that sends
    // are simulated until Infobip is configured
    return <ChatsView configured={isInfobipConfigured()} />
}
