import { desc, eq } from "drizzle-orm"

import { db } from "@workspace/db/db"
import { member } from "@workspace/db/users"
import { auth } from "@workspace/auth/server"
import { configureEdgeStore, createEdgeStoreHandler } from "@workspace/edgestore/server"
import { isKycSubjectType, kycSubjectOwner } from "@workspace/domain/kyc/tenant-access"
import { threadParty } from "@workspace/domain/threads/queries"

// Who a driver or vehicle belongs to, for the KYC bucket's fleet uploads,
// and who is a party to a thread, for the attachments bucket — the same
// lookups the tRPC gates make, so a file can only be written where the
// mutation would then accept it.
configureEdgeStore({
    resolveKycSubjectOwner: async (subjectType, subjectId) =>
        isKycSubjectType(subjectType) ? kycSubjectOwner(db, subjectType, subjectId) : null,
    resolveThreadParty: (threadId, organizationId) => threadParty(db, threadId, organizationId),
})

/**
 * No staff resolver: nothing signed in here is staff, so the KYC bucket
 * stays closed apart from what a company may file itself — its own
 * verification papers under its own `organization/<id>/` prefix, the signed
 * contract excepted (Appload files that one after signature), and the papers
 * of the drivers and vehicles in its own registry. Everything else the portal
 * uploads is order documents (POD, evidence).
 *
 * Membership is read live from the database rather than from the session
 * cookie's cached `activeOrganizationId` — a just-accepted invitation leaves
 * that stale for up to five minutes, and a removed member must lose the
 * bucket at once. The organization prefix is that same organization id, so
 * the live answer is what decides which company's papers a member can write
 * to.
 */
const handler = createEdgeStoreHandler(auth, undefined, async (userId) => {
    const [membership] = await db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, userId))
        .orderBy(desc(member.createdAt))
        .limit(1)

    return membership?.organizationId ?? null
})

export { handler as GET, handler as POST }
