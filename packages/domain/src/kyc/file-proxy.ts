import "server-only";

import type { KycPage, KycSubjectType } from "@workspace/db/types";

import { isKycMimeType, isKycUrl, mimeFromUrl } from "@workspace/domain/kyc/file-access";

/**
 * The body of the KYC page proxy, shared by Admin's route and the portal's.
 *
 * Both apps serve `/api/kyc/file/[documentId]/[page]`, because a document
 * rewritten by `withProxiedPages` carries that one href whichever app asked
 * for it. What differs is the gate in front — staff in Admin, the tenant's
 * own subjects and its orders' dispatch packs in the portal — so the gate
 * stays in each route and the fetch lives here.
 */

// Matches the kycFiles bucket's own ceiling. Applied to what storage claims,
// so an object that somehow grew past the bucket limit cannot be relayed.
const MAX_BYTES = 5 * 1024 * 1024;

// Long enough for the storage CDN to answer, short enough that a hung upstream
// does not pin a serverless invocation. It covers the response headers ONLY —
// see the clearTimeout below.
const HEADER_TIMEOUT_MS = 15_000;

// Identity documents: never held by a CDN or shared proxy, never written to
// the browser's disk cache, and never sniffed into some other content type
const PRIVATE_HEADERS = {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
} as const;

/** An empty response carrying the same headers a served page does. */
export function denyKycPage(status: number) {
    return new Response(null, { status, headers: PRIVATE_HEADERS });
}

/** What the proxy needs of a document row to serve one of its pages. */
export type ProxiedDocument = {
    id: string
    subjectType: KycSubjectType
    subjectId: string
    pages: KycPage[]
};

/**
 * Streams one page of a KYC document from storage through our own origin.
 *
 * The storage bucket behind these files is world-readable — EdgeStore's
 * protected files are not enabled on this account — so its URLs are treated
 * as secrets and never leave the server: every page a query hands out is
 * rewritten to the proxy route (kyc/file-access.ts), and this is what puts
 * real bytes behind it.
 */
export async function streamKycPage(
    document: ProxiedDocument,
    index: number,
): Promise<Response> {
    const target = document.pages[index];

    if (!target) return denyKycPage(404);

    // Re-checked here, not trusted from the row: this is the point where
    // stored text becomes an outbound request
    if (!isKycUrl(target.url, document.subjectType, document.subjectId)) {
        console.error(`[kyc] refusing to fetch off-bucket url on document ${document.id}`);
        return denyKycPage(502);
    }

    // The deadline covers reaching the storage CDN, not draining the body.
    // Leaving it on the whole transfer would abort mid-stream long after the
    // 200 was committed, and a reviewer would silently get a half-rendered ID
    // document with no way for us to signal the failure.
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), HEADER_TIMEOUT_MS);

    let upstream: Response;

    try {
        upstream = await fetch(target.url, {
            cache: "no-store",
            redirect: "error",
            signal: controller.signal,
            // Keeps the upstream length meaningful; fetch would otherwise hand
            // back a decoded body whose size no longer matches its header
            headers: { "accept-encoding": "identity" },
        });
    } catch (error) {
        console.error(`[kyc] fetch failed for document ${document.id} page ${index}`, error);
        return denyKycPage(502);
    } finally {
        clearTimeout(deadline);
    }

    if (!upstream.ok || !upstream.body) return denyKycPage(502);

    if (Number(upstream.headers.get("content-length")) > MAX_BYTES) return denyKycPage(502);

    // Resolved the same way the client resolves it (file-access.ts), so the
    // type the viewer renders against always matches the type we send.
    // Anything still unrecognised goes out as an opaque download rather than
    // as something the browser will try to render.
    const mimeType = isKycMimeType(target.mimeType)
        ? target.mimeType
        : mimeFromUrl(target.url) ?? "application/octet-stream";

    // Content-Length is deliberately not forwarded: the body streaming out
    // here is whatever fetch decoded, so relaying the upstream figure risks
    // framing the response at the wrong size and truncating the document
    return new Response(upstream.body, {
        status: 200,
        headers: {
            ...PRIVATE_HEADERS,
            "Content-Type": mimeType,
            "Content-Disposition": mimeType === "application/octet-stream" ? "attachment" : "inline",
        },
    });
}
