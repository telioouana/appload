import type { NotificationKind, NotificationParams } from "@workspace/db/notifications";

import { brandedEmail } from "@workspace/auth/email";
import { createTranslator } from "@workspace/i18n";
import { DEFAULT_LOCALE } from "@workspace/i18n/locales";

import { icuValues, kindMessageKey } from "@/frontend/pages/notifications/types";
import { pt } from "@/messages";

/**
 * The catalog is read here instead of through next-intl's request config
 * because the outbox renders from a cron run: there is no request, no
 * headers and no locale to detect. The portal keeps no per-user language
 * either, so every notification email is Portuguese (§5 of the plan).
 *
 * The typed key union is dropped on purpose: a notification's message key is
 * built from a database column, and its ICU arguments are whatever the
 * writer put on the row — neither is knowable at compile time.
 */
const translate = createTranslator({ locale: DEFAULT_LOCALE, messages: pt }) as unknown as
    (key: string, values?: Record<string, string | number>) => string;

/**
 * The email for one notification row, ready for `sendEmail`.
 *
 * The kind's own message is the headline and travels into the subject; the
 * greeting and the closing line are the body around it, and the button opens
 * the thing that happened — the dashboard when the event has no page of its
 * own. `href` is a portal path, always the internal (English) route name:
 * with `localePrefix: "never"` next-intl sends the reader on to their own
 * slug, so one link works in both languages.
 */
export function renderNotificationEmail(input: {
    kind: NotificationKind;
    params: NotificationParams;
    href: string | null;
}): { subject: string; html: string } {
    // The same key the inbox renders the row from, so a kind's copy is
    // written once and the email says what the portal says
    const title = translate(`App.notifications.kinds.${kindMessageKey(input.kind)}`, icuValues(input.params));

    return {
        subject: translate("App.notifications.email.subject", { title }),
        html: brandedEmail({
            title,
            lines: [translate("App.notifications.email.greeting"), translate("App.notifications.email.footer")],
            ctaLabel: translate("App.notifications.email.cta"),
            ctaUrl: `${process.env.NEXT_PUBLIC_PORTAL_URL ?? ""}${input.href ?? "/dashboard"}`,
            disclaimer: translate("App.notifications.email.disclaimer"),
            locale: DEFAULT_LOCALE,
        }),
    };
}
