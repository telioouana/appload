import { google } from "googleapis";

import { OrderError } from "./errors";
import { SPREADSHEETS_SCOPE } from "./google-token";

// Derived from the constructor so it can't drift to another hoisted copy
// of google-auth-library, which pnpm resolves at a different version
type JwtClient = InstanceType<typeof google.auth.JWT>;

let jwtClient: JwtClient | null = null;

function getJwtClient(): JwtClient {
    if (jwtClient) {
        return jwtClient;
    }

    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    // The PEM may be stored single-line with escaped newlines
    const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (!email || !key) {
        throw new OrderError("SHEET_FAILED", "Google service account is not configured");
    }

    jwtClient = new google.auth.JWT({ email, key, scopes: [SPREADSHEETS_SCOPE] });

    return jwtClient;
}

/**
 * Returns an access token for the shared Sheets service account. The JWT
 * client caches the token and re-mints it when expired. The spreadsheet
 * must be shared with the service account as Editor.
 */
export async function getServiceAccountAccessToken(): Promise<string> {
    try {
        const { token } = await getJwtClient().getAccessToken();

        if (!token) {
            throw new OrderError("SHEET_FAILED", "Service account returned no access token");
        }

        return token;
    } catch (error) {
        if (error instanceof OrderError) {
            throw error;
        }

        throw new OrderError("SHEET_FAILED", error instanceof Error ? error.message : undefined);
    }
}
