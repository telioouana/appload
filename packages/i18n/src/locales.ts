// The single shared i18n truth across apps. Routing (prefix strategy,
// pathnames) is app-owned — each app defines its own `src/i18n/routing.ts`
// on top of these constants.
export const LOCALES = ["pt", "en"] as const;

export const DEFAULT_LOCALE = "pt" satisfies (typeof LOCALES)[number];
