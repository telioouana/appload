import { eq } from "drizzle-orm";

import { db } from "@workspace/db/db";
import { auth } from "@workspace/auth/server";
import { kycDocument } from "@workspace/db/kyc-documents";
import { getStaffGates } from "@workspace/trpc/staff-gate";
import { isAuthorized } from "@workspace/auth/user-permissions";

import { isKycMimeType, isKycUrl, mimeFromUrl } from "@/lib/kyc/file-access";

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

function deny(status: number) {
    return new Response(null, { status, headers: PRIVATE_HEADERS });
}

/**
 * Streams one page of a KYC document to a signed-in staff reviewer.
 *
 * The storage bucket behind these files is world-readable — EdgeStore's
 * protected files are not enabled on this account — so its URLs are treated as
 * secrets and never leave the server. kyc.documents rewrites every page to
 * this route instead (lib/kyc/file-access.ts), which puts a real session check
 * in front of bytes that are otherwise public to anyone holding a link.
 *
 * Staff status is read live from the database rather than from the session
 * cookie, matching the tRPC gate: a demotion has to cut access to ID scans
 * immediately, not at the next cookie refresh.
 */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ documentId: string; page: string }> },
) {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) return deny(401);

    const staff = await getStaffGates(db, { userId: session.user.id });

    if (!staff.isStaff || !isAuthorized(staff.role, "kyc", ["read"])) {
        return deny(403);
    }

    const { documentId, page } = await params;
    const index = Number(page);

    if (!Number.isInteger(index) || index < 0) return deny(400);

    const [document] = await db
        .select()
        .from(kycDocument)
        .where(eq(kycDocument.id, documentId))
        .limit(1);

    if (!document) return deny(404);

    const target = document.pages[index];

    if (!target) return deny(404);

    // Re-checked here, not trusted from the row: this is the point where
    // stored text becomes an outbound request
    if (!isKycUrl(target.url, document.subjectType, document.subjectId)) {
        console.error(`[kyc] refusing to fetch off-bucket url on document ${document.id}`);
        return deny(502);
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
        return deny(502);
    } finally {
        clearTimeout(deadline);
    }

    if (!upstream.ok || !upstream.body) return deny(502);

    if (Number(upstream.headers.get("content-length")) > MAX_BYTES) return deny(502);

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
