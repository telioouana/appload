import { desc, eq } from "drizzle-orm"

import { db } from "@workspace/db/db"
import { member } from "@workspace/db/users"
import { auth } from "@workspace/auth/server"
import { createEdgeStoreHandler } from "@workspace/edgestore/server"

/**
 * No staff resolver: the KYC bucket stays closed in the portal, which only
 * uploads order documents (POD, evidence). Membership is read live from the
 * database rather than from the session cookie's cached
 * `activeOrganizationId` — a just-accepted invitation leaves that stale for
 * up to five minutes, and a removed member must lose the bucket at once.
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
