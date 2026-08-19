import type { Locale } from './index.ts';
import messages from './messages/pt.json';

type Messages = typeof messages;

declare module 'next-intl' {
    interface AppConfig {
        Locale: Locale;
        Messages: Messages;
    }
}