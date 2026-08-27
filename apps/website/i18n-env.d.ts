import type { Locale } from "@workspace/i18n";

import type messages from "./src/messages/pt.json";

// Website message keys are typed against the app-local pt.json — the
// website owns its translations; the shared packages/i18n messages belong
// to the website.
declare module "next-intl" {
    interface AppConfig {
        Locale: Locale;
        Messages: typeof messages;
    }
}
