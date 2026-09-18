import { and, eq, isNull } from "drizzle-orm";

import { db } from "@workspace/db/db";
import { auth } from "@workspace/auth/server";
import { kycDocument } from "@workspace/db/kyc-documents";
import { getTenantGates } from "@workspace/trpc/tenant-gate";
import { isOrgAuthorized } from "@workspace/auth/organization-permissions";

import { denyKycPage as deny, streamKycPage } from "@workspace/domain/kyc/file-proxy";
import { tenantCanReadKycDocument } from "@workspace/domain/kyc/tenant-access";

/**
 * Streams one page of a KYC document to a signed-in partner.
 *
 * Same path as Admin's route on purpose: `withProxiedPages` rewrites a
 * document's pages to `/api/kyc/file/...` before it leaves the server, and
 * that one href has to resolve in whichever app asked for it.
 *
 * What differs is the gate. Admin asks whether the caller is staff; here the
 * question is whether this company may see this paper at all — its own
 * driver's or vehicle's, or one that travelled in the dispatch pack of an
 * order it is a party to. The membership behind that is read live from the
 * database, never from the session cookie, for the same reason the tRPC gate
 * does: a removed member must lose ID scans at once.
 */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ documentId: string; page: string }> },
) {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) return deny(401);

    const tenant = await getTenantGates(db, { userId: session.user.id });

    if (!tenant.ok || !isOrgAuthorized(tenant.role, "kyc", ["read"])) return deny(403);

    const { documentId, page } = await params;
    const index = Number(page);

    if (!Number.isInteger(index) || index < 0) return deny(400);

    // Soft-deleted rows are gone as far as a partner is concerned: a scan
    // withdrawn because it was filed against the wrong person must stop
    // being fetchable by whoever already holds its href
    const [document] = await db
        .select()
        .from(kycDocument)
        .where(and(eq(kycDocument.id, documentId), isNull(kycDocument.deletedAt)))
        .limit(1);

    if (!document) return deny(404);

    // A document this company has no claim on is not merely forbidden — it
    // must not be distinguishable from one that does not exist
    if (!await tenantCanReadKycDocument(db, tenant.organizationId, document)) return deny(404);

    return streamKycPage(document, index);
}
