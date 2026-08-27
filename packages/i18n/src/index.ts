import { LOCALES } from "@workspace/i18n/locales";

export type Locale = (typeof LOCALES)[number];

export { LOCALES, DEFAULT_LOCALE } from "@workspace/i18n/locales";

export * from 'next-intl';
