import type { Locale } from "@workspace/i18n";

import type { Messages } from "./src/messages";

// Portal message keys are typed against the assembled pt catalog
// (src/messages/index.ts: pt.json plus one file per feature) — the portal
// owns its translations, mirroring the admin's setup.
declare module "next-intl" {
    interface AppConfig {
        Locale: Locale;
        Messages: Messages;
    }
}
