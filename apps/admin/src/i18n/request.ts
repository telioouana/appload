import { locale as rootLocale } from "next/root-params";

import { hasLocale } from "@workspace/i18n";
import { getRequestConfig } from "@workspace/i18n/server";

import { routing } from "@/i18n/routing";

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
    };
});
