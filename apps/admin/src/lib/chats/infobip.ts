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
    /** Human-readable body to store in the chat thread, whatever the kind */
    text: string;
    kind: "text" | "button" | "location";
    /** Quick-reply parameter echoed back when the driver taps a template button */
    buttonPayload: string | null;
    location: { latitude: number; longitude: number } | null;
    externalId: string | null;
};

/**
 * Quick-reply payload on the tracking template's "share location" button.
 * The suffix carries the order id, so the webhook knows which load the tap
 * answers: "share-location:APPL021.26".
 */
export const SHARE_LOCATION_PAYLOAD = "share-location";

export const shareLocationPayload = (orderId: string) =>
    `${SHARE_LOCATION_PAYLOAD}:${orderId}`;

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
 *
 * When the registered template carries a quick-reply button, WhatsApp
 * requires its postback parameter on every send — pass it as buttonPayload
 * (and omit it for body-only templates, or Infobip rejects the mismatch).
 */
export async function sendWhatsAppTemplate(
    to: string,
    placeholders: string[],
    buttonPayload?: string,
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
                        templateData: {
                            body: { placeholders },
                            ...(buttonPayload
                                ? { buttons: [{ type: "QUICK_REPLY", parameter: buttonPayload }] }
                                : {}),
                        },
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

/** Load context woven into location-request copy when the caller has it. */
export type RouteDetails = {
    truckPlate: string | null;
    origin: string;
    destination: string;
};

/**
 * Body for the location-request message, in the language the tracking
 * template was registered in. WhatsApp renders the "Send location" button
 * itself, localized by the driver's device. Route details are optional
 * because the webhook path only knows the order id from the button payload.
 */
export function locationRequestText(orderId: string | null, route?: RouteDetails): string {
    const pt = (process.env.INFOBIP_TRACKING_TEMPLATE_LANGUAGE ?? "pt").startsWith("pt");

    if (pt) {
        const load = orderId ? ` para a carga ${orderId}` : "";
        const detail = route
            ? ` (${route.truckPlate ? `camião ${route.truckPlate}, ` : ""}de ${route.origin} para ${route.destination})`
            : "";

        return `Toque em "Enviar localização" abaixo para partilhar a sua localização atual${load}${detail}.`;
    }

    const load = orderId ? ` for load ${orderId}` : "";
    const detail = route
        ? ` (${route.truckPlate ? `truck ${route.truckPlate}, ` : ""}from ${route.origin} to ${route.destination})`
        : "";

    return `Tap "Send location" below to share your current location${load}${detail}.`;
}

/**
 * Rendered body of the registered tracking template (source of truth:
 * scripts/infobip-templates.mjs — keep the copy in sync), so the chat thread
 * mirror shows what the driver actually received. Same language switch as
 * locationRequestText.
 */
export function trackingTemplateText(
    driverName: string,
    orderId: string,
    truckPlate: string,
    origin: string,
    destination: string,
): string {
    const pt = (process.env.INFOBIP_TRACKING_TEMPLATE_LANGUAGE ?? "pt").startsWith("pt");

    return pt
        ? `Olá ${driverName}, a Appload precisa que partilhe a sua localização atual para a carga ${orderId} — camião ${truckPlate}, de ${origin} para ${destination}. Envie a localização como anexo (📎 → Localização) ou toque no botão abaixo.`
        : `Hello ${driverName}, Appload needs you to share your current location for load ${orderId} — truck ${truckPlate}, from ${origin} to ${destination}. Send your location as an attachment (📎 → Location) or tap the button below.`;
}

/**
 * Sends WhatsApp's native location-request message — the one whose built-in
 * "Send location" button opens the phone's location picker. Session-only:
 * WhatsApp accepts it inside the 24h window after the driver's last message.
 * Two callers: the tracking cron sends it directly when the driver's session
 * window is still open (one tap for the driver), and the webhook sends it
 * after a tap on the tracking template's quick-reply button (the tap opens
 * the window, this follows immediately).
 */
export async function sendWhatsAppLocationRequest(to: string, text: string): Promise<OutboundResult> {
    const infobip = config();

    if (!infobip) {
        return unconfiguredResult();
    }

    try {
        const response = await fetch(`${infobip.baseUrl}/whatsapp/1/message/interactive/location-request`, {
            method: "POST",
            headers: {
                "Authorization": `App ${infobip.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: infobip.sender,
                to: to.replace(/[^\d+]/g, ""),
                content: { body: { text } },
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
 * transport-agnostic messages. Recognizes plain text, quick-reply button
 * taps (type BUTTON, label in `text`, template parameter in `payload`) and
 * shared locations (type LOCATION, coordinates but usually no text).
 * Unknown entries are skipped.
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
            message?: {
                type?: string;
                text?: string;
                payload?: string;
                latitude?: number;
                longitude?: number;
                name?: string;
                address?: string;
            };
            content?: { text?: string };
        };

        if (!entry.from) {
            continue;
        }

        const message = entry.message;
        const type = message?.type?.toUpperCase();
        const externalId = entry.messageId ?? null;

        if (type === "LOCATION"
            && typeof message?.latitude === "number"
            && typeof message?.longitude === "number") {
            // Location pins carry no text — render a clickable maps link so
            // the pin survives as a plain chat body
            const place = [message.name, message.address].filter(Boolean).join(", ");

            messages.push({
                phone: entry.from,
                kind: "location",
                text: `📍 ${place ? `${place} — ` : ""}https://maps.google.com/?q=${message.latitude},${message.longitude}`,
                buttonPayload: null,
                location: { latitude: message.latitude, longitude: message.longitude },
                externalId,
            });
            continue;
        }

        const text = message?.text ?? entry.content?.text;

        if (!text) {
            continue;
        }

        if (type === "BUTTON" || typeof message?.payload === "string") {
            messages.push({
                phone: entry.from,
                kind: "button",
                text,
                buttonPayload: message?.payload ?? null,
                location: null,
                externalId,
            });
            continue;
        }

        messages.push({
            phone: entry.from,
            kind: "text",
            text,
            buttonPayload: null,
            location: null,
            externalId,
        });
    }

    return messages;
}
