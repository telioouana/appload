import { db } from "@workspace/db/db"
import { auth } from "@workspace/auth/server"
import { getStaffGates } from "@workspace/trpc/staff-gate"
import { createEdgeStoreHandler } from "@workspace/edgestore/server"

// The KYC bucket serves identity documents, so staff status is read live
// from the database — the same gate the tRPC procedures apply, rather than
// the session's cached copy
const handler = createEdgeStoreHandler(auth, async (userId) => {
    const { isStaff } = await getStaffGates(db, { userId })
    return isStaff
})

export { handler as GET, handler as POST }
