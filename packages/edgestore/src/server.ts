import { z } from "zod"
import { initEdgeStore } from "@edgestore/server"
import {
    createEdgeStoreNextHandler,
    type CreateContextOptions,
} from "@edgestore/server/adapters/next/app"

import { type Auth } from "@workspace/auth/server"

import { STORAGE_PATH_RE } from "@workspace/edgestore/path"

/**
 * Available in every bucket hook (`beforeUpload`, `beforeDelete`, `path`).
 * Derived from the better-auth session, same as the tRPC context.
 */
type Context = {
    userId: string | null
    orgId: string | null
    // Resolved live from the database by the host app, not read from the
    // session: KYC scans are ID documents, so a demotion must cut access off
    // immediately rather than when the session cookie next refreshes.
    // A string because EdgeStore only matches string context values in
    // access-control rules.
    isStaff: "true" | "false"
}

const es = initEdgeStore.context<Context>().create()

/**
 * The `input` schemas below are types, not guards: neither
 * `@edgestore/server` nor `@edgestore/react` ever parses them at runtime —
 * they only type the `upload({ input })` argument. The values still become
 * path segments, so anything that must actually hold is re-checked in
 * `beforeUpload`, the one hook that receives the real input, and which runs
 * before the path is built.
 *
 * Rejecting rather than folding: a bad value means the caller skipped
 * `toStoragePath`, and silently rewriting it would file the document
 * somewhere other than where the caller believes it went. EdgeStore's own
 * rejection is a 400 that reaches the browser as a bare "Internal server
 * error", so the reason is logged here.
 */
function isLegal(label: string, value: unknown, pattern: RegExp): boolean {
    if (typeof value !== "string" || !pattern.test(value)) {
        console.error(`edgestore: illegal ${label}`, value)
        return false
    }

    return true
}

/**
 * Shapes for the KYC path segments, held in one place because the schema
 * that declares them to callers is not what enforces them. Lengths live in
 * the patterns so the two cannot drift apart.
 */
const KYC_SEGMENT = {
    subjectType: /^[a-z][a-z-]{0,31}$/,
    subjectId: /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/,
    docType: /^[a-z][a-z-]{0,63}$/,
} as const

export const edgeStoreRouter = es.router({
    apploadFiles: es
        .fileBucket({
            // Order documents: PDF, JPG and PNG
            accept: ["application/pdf", "image/jpeg", "image/png"],
        })
        // Callers must fold this through `toStoragePath` (or build it with
        // `orderDocumentPath`) — order prefixes carry the human order id,
        // whose dot EdgeStore rejects. See packages/edgestore/src/path.ts
        // for why the folding cannot happen on this side.
        .input(z.object({ path: z.string().max(512) }))
        // These entries are not values: EdgeStore calls this resolver once
        // at module load with proxies, records the accessor each property
        // returns ("ctx.userId", "input.path") and resolves them per
        // request. Nothing computed here would ever see real data.
        .path(({ ctx, input }) => [
            { owner: ctx.userId },
            { path: input.path },
        ])
        // Staff-only, not merely authenticated: shipper, carrier and driver
        // accounts exist in the same auth system, and a bare session check
        // would let any of them overwrite or delete order documents
        .beforeUpload(({ ctx, input }) =>
            ctx.isStaff === "true" &&
            isLegal("bucket path", input.path, STORAGE_PATH_RE),
        )
        // Without this hook, client-side `delete()` calls are always rejected
        .beforeDelete(({ ctx }) => ctx.isStaff === "true"),

    /**
     * Verification documents: ID cards, NUIT certificates, licences,
     * vehicle booklets, signed contracts.
     *
     * Separate from apploadFiles because these are personal identity
     * documents, and separating them is what makes it possible to protect
     * them independently.
     *
     * The objects themselves are world-readable: EdgeStore's protected files
     *
     *     .accessControl({ isStaff: { eq: "true" } })
     *
     * are not enabled on this account, and adding that line makes every
     * EdgeStore request fail with a 500 — which would break order-document
     * uploads too.
     *
     * So the URLs are treated as secrets instead. They are never sent to a
     * browser: the host app rewrites every page to a session-gated route
     * (apps/admin/src/app/api/kyc/file/[documentId]/[page]) that re-checks
     * staff status against the database and streams the bytes itself. Writing
     * and deleting stay staff-only through the hooks below.
     *
     * That leaves one residue this design cannot fix — an object whose URL
     * leaked BEFORE the proxy existed is still fetchable by whoever holds it.
     * Enabling protected files (and restoring the line above), or re-keying
     * the existing objects, is what closes that.
     *
     * Paths are keyed on IDs, never on names or plates: a company renames
     * itself and a vehicle changes plate, but its documents must not move.
     */
    kycFiles: es
        .fileBucket({
            accept: ["application/pdf", "image/jpeg", "image/png"],
            maxSize: 5 * 1024 * 1024,
        })
        // These three become path segments, so they are constrained to a
        // slug charset rather than accepted as free strings — otherwise a
        // caller could steer the path anywhere, including over another
        // subject's documents. Which *values* are legal document types is
        // the router's business (kyc.upload validates against the real
        // vocabularies); this package only guarantees the shape.
        //
        // The schema states that shape for callers; KYC_SEGMENT below is
        // what enforces it, because this schema never runs.
        .input(z.object({
            subjectType: z.string().regex(KYC_SEGMENT.subjectType),
            subjectId: z.string().regex(KYC_SEGMENT.subjectId),
            docType: z.string().regex(KYC_SEGMENT.docType),
        }))
        .path(({ input }) => [
            { subject: input.subjectType },
            { id: input.subjectId },
            { type: input.docType },
        ])
        // Rejected rather than folded: these are identity keys, and folding
        // two distinct subject ids onto one segment would file one
        // subject's ID documents under another
        .beforeUpload(({ ctx, input }) =>
            ctx.isStaff === "true" &&
            Object.entries(KYC_SEGMENT).every(([key, pattern]) =>
                isLegal(`kyc ${key}`, (input as Record<string, unknown>)[key], pattern),
            ),
        )
        .beforeDelete(({ ctx }) => ctx.isStaff === "true"),
})

export type EdgeStoreRouter = typeof edgeStoreRouter

/**
 * Builds the Next.js App Router handler. The app mounts it at
 * `app/api/edgestore/[...edgestore]/route.ts`, passing its auth instance —
 * mirroring how `createTRPCContext` receives `auth` from the tRPC route.
 *
 * `resolveStaff` is supplied by the host app rather than resolved here, so
 * this package stays a thin wrapper with no database dependency of its own.
 * Omitting it leaves `isStaff` false, which closes the KYC bucket entirely.
 */
export const createEdgeStoreHandler = (
    auth: Auth,
    resolveStaff?: (userId: string) => Promise<boolean>,
) =>
    createEdgeStoreNextHandler({
        router: edgeStoreRouter,
        createContext: async ({
            req,
        }: CreateContextOptions): Promise<Context> => {
            const session = await auth.api.getSession({ headers: req.headers })
            const userId = session?.user.id ?? null

            return {
                userId,
                orgId: session?.session.activeOrganizationId ?? null,
                isStaff: userId !== null && resolveStaff !== undefined && await resolveStaff(userId)
                    ? "true"
                    : "false",
            }
        },
    })
