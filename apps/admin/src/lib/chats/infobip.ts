/**
 * Infobip adapter. All platform-specific knowledge lives here so the rest
 * of the chat feature is transport-agnostic.
 *
 * Configure by setting in apps/admin/.env.local:
 *   INFOBIP_BASE_URL=https://<your-subdomain>.api.infobip.com
 *   INFOBIP_API_KEY=<api key>
 *   INFOBIP_SENDER=<registered WhatsApp sender number>
 *   INFOBIP_WEBHOOK_SECRET=<shared secret echoed by the inbound webhook>
 *
 * Until those are set, sends are simulated (stored locally, marked "sent")
 * so the chat environment works end-to-end without the platform.
 */

export type OutboundResult =
    | { ok: true; externalId: string | null; simulated: boolean }
    | { ok: false; error: string };

export type InboundMessage = {
    phone: string;
    text: string;
    externalId: string | null;
};

function config() {
    const baseUrl = process.env.INFOBIP_BASE_URL;
    const apiKey = process.env.INFOBIP_API_KEY;
    const sender = process.env.INFOBIP_SENDER;

    if (!baseUrl || !apiKey || !sender) {
        return null;
    }

    return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, sender };
}

export const isInfobipConfigured = () => config() !== null;

// Simulation is a development convenience. In production an unconfigured
// provider must fail the send — otherwise operators see messages marked
// "sent" that no driver ever received.
function unconfiguredResult(): OutboundResult {
    if (process.env.NODE_ENV === "production") {
        return { ok: false, error: "INFOBIP_NOT_CONFIGURED" };
    }

    return { ok: true, externalId: null, simulated: true };
}

/** Sends a WhatsApp text message through Infobip; simulated when unconfigured. */
export async function sendWhatsAppText(to: string, text: string): Promise<OutboundResult> {
    const infobip = config();

    if (!infobip) {
        return unconfiguredResult();
    }

    try {
        const response = await fetch(`${infobip.baseUrl}/whatsapp/1/message/text`, {
            method: "POST",
            headers: {
                "Authorization": `App ${infobip.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: infobip.sender,
                to: to.replace(/[^\d+]/g, ""),
                content: { text },
            }),
        });

        if (!response.ok) {
            return { ok: false, error: `Infobip responded ${response.status}: ${await response.text()}` };
        }

        const data = (await response.json()) as { messageId?: string };

        return { ok: true, externalId: data.messageId ?? null, simulated: false };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Unknown Infobip error" };
    }
}

/**
 * Sends a pre-approved WhatsApp template through Infobip — required outside
 * the 24h session window, so the tracking cron always uses templates.
 * Configure the registered template via:
 *   INFOBIP_TRACKING_TEMPLATE=<template name>
 *   INFOBIP_TRACKING_TEMPLATE_LANGUAGE=pt   (defaults to pt)
 * Simulated when Infobip is unconfigured; fails cleanly when the template
 * name is missing.
 */
export async function sendWhatsAppTemplate(
    to: string,
    placeholders: string[],
): Promise<OutboundResult> {
    const infobip = config();

    if (!infobip) {
        return unconfiguredResult();
    }

    const templateName = process.env.INFOBIP_TRACKING_TEMPLATE;

    if (!templateName) {
        return { ok: false, error: "INFOBIP_TRACKING_TEMPLATE is not set" };
    }

    try {
        const response = await fetch(`${infobip.baseUrl}/whatsapp/1/message/template`, {
            method: "POST",
            headers: {
                "Authorization": `App ${infobip.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messages: [{
                    from: infobip.sender,
                    to: to.replace(/[^\d+]/g, ""),
                    content: {
                        templateName,
                        templateData: { body: { placeholders } },
                        language: process.env.INFOBIP_TRACKING_TEMPLATE_LANGUAGE ?? "pt",
                    },
                }],
            }),
        });

        if (!response.ok) {
            return { ok: false, error: `Infobip responded ${response.status}: ${await response.text()}` };
        }

        const data = (await response.json()) as { messages?: { messageId?: string }[] };

        return { ok: true, externalId: data.messages?.[0]?.messageId ?? null, simulated: false };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Unknown Infobip error" };
    }
}

/** Sends an SMS through Infobip — the tracking cron's third-attempt fallback. */
export async function sendSmsText(to: string, text: string): Promise<OutboundResult> {
    const infobip = config();

    if (!infobip) {
        return unconfiguredResult();
    }

    try {
        const response = await fetch(`${infobip.baseUrl}/sms/2/text/advanced`, {
            method: "POST",
            headers: {
                "Authorization": `App ${infobip.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messages: [{
                    // SMS sender ids are alphanumeric or a number; reuse the
                    // WhatsApp sender unless a dedicated one is configured
                    from: process.env.INFOBIP_SMS_SENDER ?? infobip.sender,
                    destinations: [{ to: to.replace(/[^\d+]/g, "") }],
                    text,
                }],
            }),
        });

        if (!response.ok) {
            return { ok: false, error: `Infobip responded ${response.status}: ${await response.text()}` };
        }

        const data = (await response.json()) as { messages?: { messageId?: string }[] };

        return { ok: true, externalId: data.messages?.[0]?.messageId ?? null, simulated: false };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Unknown Infobip error" };
    }
}

export type DeliveryReport = {
    externalId: string;
    // Collapsed from Infobip's status groups: DELIVERED → delivered,
    // REJECTED/EXPIRED/UNDELIVERABLE → failed, anything else ignored
    status: "delivered" | "failed";
};

/**
 * Parses Infobip's delivery-report webhook payload (`results[]` with
 * messageId + status.groupName) into per-message outcomes. Entries without
 * a terminal outcome (PENDING...) are skipped.
 */
export function parseDeliveryReports(payload: unknown): DeliveryReport[] {
    const results = (payload as { results?: unknown[] })?.results;

    if (!Array.isArray(results)) {
        return [];
    }

    const reports: DeliveryReport[] = [];

    for (const result of results) {
        const entry = result as {
            messageId?: string;
            status?: { groupName?: string };
        };

        if (!entry.messageId || !entry.status?.groupName) {
            continue;
        }

        const group = entry.status.groupName.toUpperCase();

        if (group === "DELIVERED") {
            reports.push({ externalId: entry.messageId, status: "delivered" });
        } else if (group === "REJECTED" || group === "EXPIRED" || group === "UNDELIVERABLE") {
            reports.push({ externalId: entry.messageId, status: "failed" });
        }
    }

    return reports;
}

/**
 * Parses Infobip's inbound-message webhook payload (`results[]`) into
 * transport-agnostic messages. Unknown entries are skipped.
 */
export function parseInboundWebhook(payload: unknown): InboundMessage[] {
    const results = (payload as { results?: unknown[] })?.results;

    if (!Array.isArray(results)) {
        return [];
    }

    const messages: InboundMessage[] = [];

    for (const result of results) {
        const entry = result as {
            from?: string;
            messageId?: string;
            message?: { text?: string; type?: string };
            content?: { text?: string };
        };

        const text = entry.message?.text ?? entry.content?.text;

        if (entry.from && text) {
            messages.push({
                phone: entry.from,
                text,
                externalId: entry.messageId ?? null,
            });
        }
    }

    return messages;
}
