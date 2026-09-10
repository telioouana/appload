import { desc, eq } from "drizzle-orm"

import { db } from "@workspace/db/db"
import { member } from "@workspace/db/users"
import { auth } from "@workspace/auth/server"
import { getStaffGates } from "@workspace/trpc/staff-gate"
import { createEdgeStoreHandler } from "@workspace/edgestore/server"

// The KYC bucket serves identity documents, so staff status is read live
// from the database — the same gate the tRPC procedures apply, rather than
// the session's cached copy.
//
// Membership is read live for the same reason, now that the order-documents
// bucket answers to organization members and not only to staff: the session
// cookie's `activeOrganizationId` is stale for up to five minutes after a
// member is added or removed, and under a shared COOKIE_DOMAIN a partner
// session reaches this origin too. Same resolver as the portal's handler.
const handler = createEdgeStoreHandler(
    auth,
    async (userId) => {
        const { isStaff } = await getStaffGates(db, { userId })
        return isStaff
    },
    async (userId) => {
        const [membership] = await db
            .select({ organizationId: member.organizationId })
            .from(member)
            .where(eq(member.userId, userId))
            .orderBy(desc(member.createdAt))
            .limit(1)

        return membership?.organizationId ?? null
    },
)

export { handler as GET, handler as POST }
