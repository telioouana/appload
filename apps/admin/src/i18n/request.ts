import { locale as rootLocale } from "next/root-params";

import { hasLocale } from "@workspace/i18n";
import { getRequestConfig } from "@workspace/i18n/server";

import { routing } from "@/i18n/routing";

// Appload runs on Mozambican time and the timestamps are read against the
// trip's day, not the reader's — a slot programmed for 17:00 has to read
// 17:00 whether the page renders on a laptop here or on Vercel (UTC).
// Without this, next-intl formats in the runtime's own zone, which is how
// the afternoon tracking slot came out two hours early in production.
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

    // Admin messages are app-owned (src/messages/*), mirroring the website —
    // the shared i18n package carries no messages. Literal specifiers keep
    // the imports statically analysable for the bundler.
    const messages = (
        locale === "en"
            ? await import("../messages/en.json")
            : await import("../messages/pt.json")
    ).default;

    return {
        locale,
        messages,
        timeZone: TIME_ZONE,
    };
});
