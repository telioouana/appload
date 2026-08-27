// Thin re-export: apps create their own navigation helpers (apps/*/src/
// i18n/navigation.ts) from their routing config; this forwards next-intl's
// factory so apps never import next-intl directly.
export * from "next-intl/navigation";
