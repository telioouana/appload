/**
 * Registers the app's WhatsApp templates with Infobip — the template copy
 * lives here, in code, and this script pushes it through Infobip's template
 * API so nothing is ever typed into the portal by hand.
 *
 * WhatsApp still requires Meta approval before a template can be sent:
 * registration submits it, then the status column shows APPROVED / PENDING /
 * REJECTED on later runs. When the registered copy drifts from the copy in
 * this file, --apply PATCHes the template in place, which re-enters Meta
 * review (approved templates: max 1 edit per 24h, 10 per 30 days).
 *
 * Usage:
 *   node apps/admin/scripts/infobip-templates.mjs            # list only
 *   node apps/admin/scripts/infobip-templates.mjs --apply    # register missing / update drifted
 *
 * Reads INFOBIP_BASE_URL, INFOBIP_API_KEY, INFOBIP_SENDER and (optionally)
 * INFOBIP_TRACKING_TEMPLATE from apps/admin/.env.local, apps/admin/.env or
 * the environment.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function env(key) {
    if (process.env[key]) {
        return process.env[key];
    }

    for (const file of ["apps/admin/.env.local", "apps/admin/.env"]) {
        try {
            const content = fs.readFileSync(path.join(root, file), "utf8");
            const match = content.match(new RegExp(`^${key}=(.+)$`, "m"));

            if (match) {
                return match[1].trim();
            }
        } catch {
            // file missing — keep looking
        }
    }

    return undefined;
}

const templateName = env("INFOBIP_TRACKING_TEMPLATE") ?? "appload_tracking_location_request";

/**
 * Source of truth for the template copy. Placeholders are positional:
 * {{1}} = driver name, {{2}} = order id, {{3}} = truck plate, {{4}} = origin
 * (state level), {{5}} = destination (state level) — matching the send in
 * lib/tracking/run-slot.ts. The quick-reply button tap posts back
 * "share-location:<orderId>" (see shareLocationPayload in lib/chats/infobip.ts),
 * which the webhook answers with WhatsApp's native location-request message.
 */
const TEMPLATES = [
    {
        name: templateName,
        language: "pt_PT",
        category: "UTILITY",
        structure: {
            body: {
                text: "Olá {{1}}, a Appload precisa que partilhe a sua localização atual para a carga {{2}} — camião {{3}}, de {{4}} para {{5}}. Envie a localização como anexo (📎 → Localização) ou toque no botão abaixo.",
                examples: ["João Macuácua", "APPL021.26", "AEL-467-MC", "Maputo", "Tete"],
            },
            buttons: [{ type: "QUICK_REPLY", text: "Partilhar localização" }],
        },
    },
    {
        name: templateName,
        language: "en",
        category: "UTILITY",
        structure: {
            body: {
                text: "Hello {{1}}, Appload needs you to share your current location for load {{2}} — truck {{3}}, from {{4}} to {{5}}. Send your location as an attachment (📎 → Location) or tap the button below.",
                examples: ["João Macuácua", "APPL021.26", "AEL-467-MC", "Maputo", "Tete"],
            },
            buttons: [{ type: "QUICK_REPLY", text: "Share location" }],
        },
    },
];

const baseUrl = env("INFOBIP_BASE_URL")?.replace(/\/$/, "");
const apiKey = env("INFOBIP_API_KEY");
const sender = env("INFOBIP_SENDER");

if (!baseUrl || !apiKey || !sender) {
    throw new Error("INFOBIP_BASE_URL, INFOBIP_API_KEY and INFOBIP_SENDER must be set (env or apps/admin/.env[.local])");
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");

const infobip = async (method, endpoint, body) => {
    const response = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: {
            "Authorization": `App ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
        throw new Error(`Infobip ${method} ${endpoint} -> ${response.status}: ${await response.text()}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
};

// Template *management* lives under /whatsapp/2 (unlike message sending,
// which is /whatsapp/1) — v1 management expects a different body shape and
// rejects this one with a bare "Invalid request body."
const templatesPath = `/whatsapp/2/senders/${encodeURIComponent(sender)}/templates`;
const existing = (await infobip("GET", templatesPath))?.templates ?? [];

console.log(`sender: ${sender}`);
console.log(`${existing.length} template(s) currently registered\n`);

const report = [];

for (const template of TEMPLATES) {
    const current = existing.find(
        (t) => t.name === template.name && t.language === template.language,
    );

    if (current) {
        // Drift = the registered copy differs from the code's copy. Editing
        // re-enters Meta review (status drops to PENDING until re-approved);
        // approved templates allow at most 1 edit per 24h / 10 per 30 days.
        const drifted = current.structure?.body?.text !== template.structure.body.text;

        if (!drifted) {
            report.push({
                name: template.name,
                language: template.language,
                action: `exists (${current.status ?? "status unknown"})`,
            });
            continue;
        }

        if (!apply) {
            report.push({
                name: template.name,
                language: template.language,
                action: `would update (${current.status ?? "status unknown"})`,
            });
            continue;
        }

        // One rejected language must not abort the other — report and move on
        try {
            const updated = await infobip(
                "PATCH",
                `${templatesPath}/${encodeURIComponent(current.id)}`,
                { category: template.category, structure: template.structure },
            );

            report.push({
                name: template.name,
                language: template.language,
                action: `updated (${updated?.status ?? "resubmitted for approval"})`,
            });
        } catch (error) {
            report.push({
                name: template.name,
                language: template.language,
                action: `FAILED: ${error instanceof Error ? error.message : error}`,
            });
        }

        continue;
    }

    if (!apply) {
        report.push({ name: template.name, language: template.language, action: "would create" });
        continue;
    }

    try {
        const created = await infobip("POST", templatesPath, template);

        report.push({
            name: template.name,
            language: template.language,
            action: `created (${created?.status ?? "submitted for approval"})`,
        });
    } catch (error) {
        report.push({
            name: template.name,
            language: template.language,
            action: `FAILED: ${error instanceof Error ? error.message : error}`,
        });
    }
}

console.table(report);

if (!apply) {
    console.log("\ndry run — pass --apply to register the missing templates");
} else {
    console.log(`\nonce approved, set INFOBIP_TRACKING_TEMPLATE=${templateName} and INFOBIP_TRACKING_TEMPLATE_LANGUAGE to the language you want drivers to receive (pt_PT or en)`);
}
