import "server-only";

import type { KycDocument } from "@workspace/db/kyc-documents";
import type { KycPage, KycSubjectType } from "@workspace/db/types";

/** What the KYC bucket accepts, and the only types the file route will serve. */
export const KYC_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;

export type KycMimeType = (typeof KYC_MIME_TYPES)[number];

export function isKycMimeType(value: string | null | undefined): value is KycMimeType {
    return typeof value === "string" && (KYC_MIME_TYPES as readonly string[]).includes(value);
}

/** The delivery host EdgeStore serves public objects from. */
const STORAGE_HOST = process.env.EDGE_STORE_PUBLIC_HOST || "files.edgestore.dev";

/**
 * Optional, and worth setting. EdgeStore's delivery host is shared across
 * every tenant, so the host alone does not identify our project — pinning the
 * id is what stops a URL belonging to somebody else's EdgeStore project from
 * satisfying this check. Unset, the bucket-name segment below is the
 * narrowest constraint available.
 */
const STORAGE_PROJECT_ID = process.env.EDGE_STORE_PROJECT_ID;

/**
 * Whether a stored page URL is one of ours.
 *
 * Checked when a page is written AND again before it is fetched. The read
 * path turns stored text into an outbound request whose body is streamed back
 * from our own origin, so a row written before this rule existed — or through
 * some future path that forgets it — must not be able to steer that fetch.
 *
 * Total by contract: every caller treats `false` as "refuse", so this must
 * never throw. A malformed percent-escape in a legacy row is a rejection, not
 * a 500.
 */
export function isKycUrl(url: string, subjectType: KycSubjectType, subjectId: string): boolean {
    try {
        const parsed = new URL(url);

        // Credentials and a custom port are never present on a real storage
        // URL, and both are classic ways to make a host check read wrong
        if (parsed.username || parsed.password || parsed.port) return false;
        if (parsed.protocol !== "https:" || parsed.hostname !== STORAGE_HOST) return false;

        const path = decodeURIComponent(parsed.pathname);

        if (STORAGE_PROJECT_ID && !path.startsWith(`/${STORAGE_PROJECT_ID}/`)) return false;

        // Public objects always carry this segment — the SDK asserts on its
        // absence itself (@edgestore/server core/client: `!url.includes(
        // "/_public/")`). The bucket name is NOT checked: the hosted provider
        // receives its access URL from api.edgestore.dev rather than building
        // it locally, so the bucket's position in the path is not something
        // this codebase can verify.
        //
        // EdgeStore builds the rest of the path from the bucket's `.path()`
        // entries, so [subjectType, subjectId, docType] appear as consecutive
        // segments
        return path.includes("/_public/")
            && path.includes(`/${subjectType}/${subjectId}/`);
    } catch {
        return false;
    }
}

/** Same-origin, session-gated href for one page of a document. */
export function kycPageHref(documentId: string, index: number): string {
    return `/api/kyc/file/${documentId}/${index}`;
}

/**
 * Best-effort type for a page stored without one. Exported so the file route
 * and the viewer derive it from the same input — if the two disagree, the
 * client renders an <object type="application/pdf"> against bytes the server
 * labelled application/octet-stream, and the preview silently breaks.
 */
export function mimeFromUrl(url: string): KycMimeType | undefined {
    const path = (url.toLowerCase().split("?")[0] ?? "");

    if (path.endsWith(".pdf")) return "application/pdf";
    if (path.endsWith(".png")) return "image/png";
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";

    return undefined;
}

/**
 * Swaps the storage URL on every page for the session-gated route, before the
 * document leaves the server.
 *
 * The bucket these live in is world-readable — EdgeStore's protected files are
 * not enabled on this account — so the storage URL is effectively the secret.
 * It stays server-side and the browser only ever sees /api/kyc/file/...
 *
 * `mimeType` is resolved here rather than in the viewer, because the proxied
 * href has no file extension left for the client to sniff.
 */
export function withProxiedPages<T extends Pick<KycDocument, "id" | "pages">>(document: T): T {
    const pages: KycPage[] = document.pages.map((page, index) => ({
        ...page,
        url: kycPageHref(document.id, index),
        mimeType: isKycMimeType(page.mimeType) ? page.mimeType : mimeFromUrl(page.url),
    }));

    return { ...document, pages };
}
