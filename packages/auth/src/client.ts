import { createAuthClient } from "better-auth/react";
import { adminClient, inferAdditionalFields, inferOrgAdditionalFields, organizationClient, phoneNumberClient, twoFactorClient } from "better-auth/client/plugins";

import { auth } from "@workspace/auth/server";
import { admin as userAdmin, manager, uac, user } from "@workspace/auth/user-permissions";
import { admin as orgAdmin, oac, owner, member } from "@workspace/auth/organization-permissions";

export const authClient = createAuthClient({
    plugins: [
        adminClient({
            ac: uac,
            roles: {
                admin: userAdmin,
                manager,
                user
            }
        }),
        phoneNumberClient(),
        organizationClient({
            organizationLimit: 1,
            ac: oac,
            roles: {
                owner,
                admin: orgAdmin,
                member
            },
            schema: inferOrgAdditionalFields<typeof auth>(),
        }),
        twoFactorClient({
            onTwoFactorRedirect: () => {
                window.location.href = "/2fa"
            },
        }),
        inferAdditionalFields<typeof auth>(),
    ],
})