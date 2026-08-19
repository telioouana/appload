import { hasLocale } from '@workspace/i18n';
import { routing } from '@workspace/i18n/routing';
import { getRequestConfig } from '@workspace/i18n/server';

export default getRequestConfig(async function createRequestConfig({
    requestLocale,
}) {
    // This typically corresponds to the `[locale]` segment
    const requested = await requestLocale;
    const locale = hasLocale(routing.locales, requested)
        ? requested
        : routing.defaultLocale;

    let messages;
    try {
        messages = (
            await (locale === routing.defaultLocale
                ? import(`@workspace/i18n/messages/pt`)
                : import(`../../../../packages/i18n/src/messages/${locale}.json`))
        ).default;
    } catch (error) {
        console.error(`Failed to load messages for locale: ${locale}`, error);
        messages = (await import(`@workspace/i18n/messages/pt`)).default;
    }

    return {
        locale,
        messages,
    };
});