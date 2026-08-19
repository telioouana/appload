import { and, eq } from "drizzle-orm";

import { db } from "@workspace/db/db";
import { account } from "@workspace/db/schema";
import type { Auth } from "@workspace/auth/server";

import { OrderError } from "./errors";
import { getServiceAccountAccessToken } from "./service-account-token";

export const SPREADSHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

/**
 * Returns an access token for Sheets writes, picking the auth method from
 * NEXT_PUBLIC_GOOGLE_SHEETS_AUTH_MODE: the shared service account while
 * per-user OAuth (spreadsheets scope) is pending Google verification,
 * otherwise the signed-in user's own Google token.
 */
export async function getSheetsAccessToken(
    authApi: Auth["api"],
    headers: Headers,
    userId: string,
): Promise<string> {
    if (process.env.NEXT_PUBLIC_GOOGLE_SHEETS_AUTH_MODE === "service-account") {
        return getServiceAccountAccessToken();
    }

    return getGoogleAccessToken(authApi, headers, userId);
}

/**
 * Returns a Google access token for the given user, able to edit
 * spreadsheets. Better Auth refreshes the token from the stored refresh
 * token when it is expired. Auth API and request headers come from the
 * tRPC context.
 */
export async function getGoogleAccessToken(
    authApi: Auth["api"],
    headers: Headers,
    userId: string,
): Promise<string> {
    const [googleAccount] = await db
        .select({ scope: account.scope })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, "google")))
        .limit(1);

    if (!googleAccount) {
        throw new OrderError("GOOGLE_NOT_LINKED");
    }

    // Accounts linked before the scope was added need to re-consent
    if (!googleAccount.scope?.includes(SPREADSHEETS_SCOPE)) {
        throw new OrderError("INSUFFICIENT_SCOPE");
    }

    try {
        const { accessToken } = await authApi.getAccessToken({
            body: { providerId: "google", userId },
            headers,
        });

        if (!accessToken) {
            throw new OrderError("GOOGLE_NOT_LINKED");
        }

        return accessToken;
    } catch (error) {
        if (error instanceof OrderError) {
            throw error;
        }

        // Refresh failed (revoked access, expired refresh token...)
        throw new OrderError("INSUFFICIENT_SCOPE", error instanceof Error ? error.message : undefined);
    }
}
