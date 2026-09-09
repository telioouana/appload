import type { Locale } from "@workspace/i18n";

import type messages from "./src/messages/pt.json";

// Portal message keys are typed against the app-local pt.json — the portal
// owns its translations, mirroring the admin's setup.
declare module "next-intl" {
    interface AppConfig {
        Locale: Locale;
        Messages: typeof messages;
    }
}
