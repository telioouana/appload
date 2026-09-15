import { desc, eq } from "drizzle-orm"

import { db } from "@workspace/db/db"
import { member } from "@workspace/db/users"
import { auth } from "@workspace/auth/server"
import { createEdgeStoreHandler } from "@workspace/edgestore/server"

/**
 * No staff resolver: nothing signed in here is staff, so the KYC bucket
 * stays closed apart from the one thing a company may file itself — its
 * signed contract with Appload, under its own `organization/<id>/` prefix.
 * Everything else the portal uploads is order documents (POD, evidence).
 *
 * Membership is read live from the database rather than from the session
 * cookie's cached `activeOrganizationId` — a just-accepted invitation leaves
 * that stale for up to five minutes, and a removed member must lose the
 * bucket at once. The contract prefix is that same organization id, so the
 * live answer is what decides which company's papers a member can write to.
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
