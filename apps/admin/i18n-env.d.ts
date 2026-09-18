import type { Locale } from "@workspace/i18n";

import type messages from "./src/messages/pt.json";

// Admin message keys are typed against the app-local pt.json — the admin
// owns its translations, mirroring the website's setup.
declare module "next-intl" {
    interface AppConfig {
        Locale: Locale;
        Messages: typeof messages;
    }
}
