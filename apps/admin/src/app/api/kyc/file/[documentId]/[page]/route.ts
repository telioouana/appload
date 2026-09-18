import { eq } from "drizzle-orm";

import { db } from "@workspace/db/db";
import { auth } from "@workspace/auth/server";
import { kycDocument } from "@workspace/db/kyc-documents";
import { getStaffGates } from "@workspace/trpc/staff-gate";
import { isAuthorized } from "@workspace/auth/user-permissions";

import { denyKycPage as deny, streamKycPage } from "@workspace/domain/kyc/file-proxy";

/**
 * Streams one page of a KYC document to a signed-in staff reviewer.
 *
 * The gate is this route's own; the fetch is shared with the portal's route
 * at the same path (kyc/file-proxy.ts), because a document rewritten by
 * `withProxiedPages` carries one href whichever app asked for it.
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

    return streamKycPage(document, index);
}
