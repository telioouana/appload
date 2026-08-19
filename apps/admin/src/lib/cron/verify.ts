import { Receiver } from "@upstash/qstash";

/**
 * The one gate for every /api/cron/* route.
 *
 * Two accepted callers:
 * - QStash (production): signs each delivery with a rotating key pair and
 *   POSTs it. Verification must run against the RAW body string — parsing
 *   and re-stringifying JSON changes the bytes and breaks the signature.
 * - A human or script (manual runs, local testing): `Authorization: Bearer
 *   $CRON_SECRET`.
 *
 * Both fail closed: with neither the signing keys nor CRON_SECRET set, no
 * request is ever authorised.
 *
 * Configure in apps/admin/.env (and the deployment's env):
 *   QSTASH_CURRENT_SIGNING_KEY=...
 *   QSTASH_NEXT_SIGNING_KEY=...
 *   CRON_SECRET=<32+ random chars, no newlines>
 */
export async function verifyCronRequest(request: Request, rawBody: string): Promise<boolean> {
    const signature = request.headers.get("upstash-signature");

    if (signature) {
        const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
        const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

        if (!currentSigningKey || !nextSigningKey) {
            return false;
        }

        try {
            const receiver = new Receiver({ currentSigningKey, nextSigningKey });
            return await receiver.verify({ signature, body: rawBody });
        } catch {
            // Bad signature, clock skew, or a body that does not match the
            // signed digest — all of them mean "not QStash"
            return false;
        }
    }

    const secret = process.env.CRON_SECRET;

    return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Reads the body once and hands back both the raw string (for signature
 * verification) and the authorisation verdict. GET requests carry no body,
 * which is fine — QStash always POSTs, so those take the bearer path.
 */
export async function authorizeCron(request: Request): Promise<boolean> {
    const rawBody = request.method === "GET" ? "" : await request.text();

    return verifyCronRequest(request, rawBody);
}
