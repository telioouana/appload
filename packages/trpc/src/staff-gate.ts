import { eq } from "drizzle-orm";

import { user } from "@workspace/db/users";
import type { db as Database } from "@workspace/db/db";
import type { StaffRole } from "@workspace/auth/user-permissions";

export type { StaffRole };

export type StaffGates = {
    // The admin app is staff-only: any authenticated non-staff account
    // (shipper, carrier, driver) is rejected before role checks even run
    isStaff: boolean;
    role: StaffRole;
};

/**
 * Reads the actor's type and platform role live from the database — the
 * cached session can lag a role change or a demotion by minutes, and a
 * hard gate must agree with the database, not with a cookie.
 */
export async function getStaffGates(
    db: typeof Database,
    params: { userId: string },
): Promise<StaffGates> {
    const [row] = await db
        .select({ type: user.type, role: user.role, banned: user.banned })
        .from(user)
        .where(eq(user.id, params.userId))
        .limit(1);

    const role: StaffRole =
        row?.role === "admin" ? "admin" :
            row?.role === "manager" ? "manager" :
                "user";

    return {
        isStaff: row?.type === "appload" && row.banned !== true,
        role,
    };
}
