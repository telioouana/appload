import { locale as rootLocale } from "next/root-params";

import { hasLocale } from "@workspace/i18n";
import { getRequestConfig } from "@workspace/i18n/server";

import { routing } from "@/i18n/routing";
import { en, pt } from "@/messages";

// The portal runs on Mozambican time for the same reason the admin does:
// a trip's timestamps are read against the trip's day, not the reader's.
// Without this, next-intl formats in the runtime's own zone (UTC on Vercel).
// Maputo is fixed UTC+2 with no DST, so this never shifts.
const TIME_ZONE = "Africa/Maputo";

export default getRequestConfig(async function createRequestConfig({
    locale: explicitLocale,
}) {
    // Explicit locale (e.g. getTranslations({locale})) wins; otherwise the
    // [locale] root param — the successor of the deprecated requestLocale
    const requested = explicitLocale ?? (await rootLocale());
    const locale = hasLocale(routing.locales, requested)
        ? requested
        : routing.defaultLocale;

    // Portal messages are app-owned and assembled per feature in
    // src/messages/index.ts — the shared i18n package carries no messages.
    return {
        locale,
        messages: locale === "en" ? en : pt,
        timeZone: TIME_ZONE,
    };
});
