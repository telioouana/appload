// Thin re-export: apps define their own routing config (apps/*/src/i18n/
// routing.ts) on top of the shared LOCALES; this just forwards next-intl's
// factory so apps never import next-intl directly.
export * from "next-intl/routing";
