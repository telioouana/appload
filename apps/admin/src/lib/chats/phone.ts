/**
 * Canonical chat identity: bare digits, matching Infobip's inbound `from`
 * ("258840000000"). Orders keep storing E.164 with "+" — normalization
 * happens only at the chat boundary, where phone equality decides which
 * thread a message belongs to.
 */
export function normalizePhone(raw: string): string {
    return raw.replace(/\D/g, "");
}
