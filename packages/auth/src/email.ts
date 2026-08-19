/**
 * Resend adapter — plain fetch against the Resend REST API, no SDK. Shared
 * by the Better Auth email hooks and the admin app (order PDF sending).
 *
 * Configure by setting in apps/admin/.env(.local):
 *   RESEND_API_KEY=<api key>
 *   EMAIL_FROM=Appload <noreply@apploadafrica.com>   (verified domain)
 *
 * Until those are set, sends are simulated (logged and reported ok) so
 * flows keep working end-to-end without the provider.
 */

export type EmailAttachment = {
    filename: string;
    // Base64-encoded file body
    content: string;
};

export type SendEmailParams = {
    to: string[];
    cc?: string[];
    subject: string;
    html: string;
    attachments?: EmailAttachment[];
};

export type SendEmailResult =
    | { ok: true; id: string | null; simulated: boolean }
    | { ok: false; error: string };

function config() {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;

    if (!apiKey || !from) {
        return null;
    }

    return { apiKey, from };
}

export const isEmailConfigured = () => config() !== null;

/**
 * HTML-escape a string to prevent XSS in email templates
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Minimal branded shell for transactional emails: logo, title, body copy,
 * one CTA button, muted disclaimer. Inline styles only — email clients
 * ignore stylesheets. (The richer react-email setup in the conecta app is
 * the eventual destination; this keeps parity without new dependencies.)
 */
export function brandedEmail(params: {
    title: string;
    lines: string[];
    ctaLabel: string;
    ctaUrl: string;
    disclaimer: string;
}): string {
    // HTML-escape all user-provided text
    const escapedTitle = escapeHtml(params.title);
    const escapedCtaLabel = escapeHtml(params.ctaLabel);
    const escapedDisclaimer = escapeHtml(params.disclaimer);

    // Validate and sanitize the CTA URL
    let validatedUrl: string;
    try {
        const parsed = new URL(params.ctaUrl);
        // Only allow http and https schemes
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('Invalid URL scheme');
        }
        validatedUrl = parsed.href;
    } catch {
        // Fallback to a safe URL if validation fails
        validatedUrl = 'about:blank';
    }

    const escapedUrl = escapeHtml(validatedUrl);

    const paragraphs = params.lines
        .map((line) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#1f2937;">${escapeHtml(line)}</p>`)
        .join("");

    return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <a href="https://appload.co.mz/"><img src="https://appload.co.mz/appload.svg" width="72" alt="Appload" /></a>
      <h1 style="margin:24px 0 16px;font-size:20px;color:#111827;">${escapedTitle}</h1>
      ${paragraphs}
      <div style="margin:24px 0;">
        <a href="${escapedUrl}" style="display:inline-block;background:#EE7623;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;">${escapedCtaLabel}</a>
      </div>
      <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#6b7280;">If the button does not work, open this link:<br /><a href="${escapedUrl}" style="color:#EE7623;word-break:break-all;">${escapedUrl}</a></p>
      <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#9ca3af;">${escapedDisclaimer}</p>
      <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">Appload — Going the extra mile</p>
    </div>
  </body>
</html>`;
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const resend = config();

    if (!resend) {
        // Simulation is a development convenience only. In production a
        // missing provider must fail loudly — auth flows (verification,
        // password reset) would otherwise tell users to check an inbox for
        // an email that was never sent.
        if (process.env.NODE_ENV === "production") {
            console.error(`[email] RESEND_API_KEY/EMAIL_FROM not set — dropping "${params.subject}"`);
            return { ok: false, error: "EMAIL_NOT_CONFIGURED" };
        }

        console.log(`[email:simulated] sent to ${params.to.length} recipient(s)`);
        return { ok: true, id: null, simulated: true };
    }

    try {
        const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${resend.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: resend.from,
                to: params.to,
                ...(params.cc?.length ? { cc: params.cc } : {}),
                subject: params.subject,
                html: params.html,
                ...(params.attachments?.length ? { attachments: params.attachments } : {}),
            }),
            signal: AbortSignal.timeout(10_000), // 10 second timeout
        });

        if (!response.ok) {
            return { ok: false, error: `Resend responded ${response.status}: ${await response.text()}` };
        }

        const data = (await response.json()) as { id?: string };

        return { ok: true, id: data.id ?? null, simulated: false };
    } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
            return { ok: false, error: "RESEND_TIMEOUT" };
        }
        return { ok: false, error: error instanceof Error ? error.message : "Unknown Resend error" };
    }
}
