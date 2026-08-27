import { locale as rootLocale } from "next/root-params";

import { hasLocale } from "@workspace/i18n";
import { getRequestConfig } from "@workspace/i18n/server";

import { routing } from "@/i18n/routing";

// Website messages are app-owned (src/messages/*), not the shared
// packages/i18n files — those belong to the admin. If a @workspace/ui
// component that calls useTranslations (file/date/scroll inputs) is ever
// used here, spread the shared General namespace in below.
export default getRequestConfig(async function createRequestConfig({
    locale: explicitLocale,
}) {
    // Explicit locale (e.g. getTranslations({locale})) wins; otherwise the
    // [locale] root param — the successor of the deprecated requestLocale
    const requested = explicitLocale ?? (await rootLocale());
    const locale = hasLocale(routing.locales, requested)
        ? requested
        : routing.defaultLocale;

    const messages = (
        locale === "en"
            ? await import("../messages/en.json")
            : await import("../messages/pt.json")
    ).default;

    return {
        locale,
        messages,
    };
});
