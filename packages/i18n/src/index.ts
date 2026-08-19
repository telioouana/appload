import {routing} from "@workspace/i18n/routing";

export type Locale = (typeof routing.locales)[number];

export * from 'next-intl';