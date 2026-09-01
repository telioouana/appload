/**
 * Minimal Google Sheets access for the maintenance scripts.
 *
 * The app reads sheets through googleapis (apps/admin), which does not
 * resolve from this package — so the service-account JWT is signed here with
 * node:crypto instead. Same credentials, same spreadsheets: the service
 * account must be an editor of any spreadsheet these helpers touch.
 */

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ENV = path.resolve(__dirname, "../../../apps/admin/.env");

/** Reads a dotenv file into a plain object; values may be quoted. */
export function loadEnv(file = DEFAULT_ENV) {
    const out = {};
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (match) out[match[1]] = match[2].trim().replace(/^["'](.*)["']$/s, "$1");
    }
    return out;
}

const base64url = (input) =>
    Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Mints a service-account access token via the JWT bearer grant. */
export async function googleAccessToken(env, scope = "https://www.googleapis.com/auth/spreadsheets") {
    const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    // The PEM is stored single-line with escaped newlines
    const privateKey = env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    if (!email || !privateKey) throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY missing");

    const issued = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = base64url(
        JSON.stringify({ iss: email, scope, aud: "https://oauth2.googleapis.com/token", iat: issued, exp: issued + 3600 }),
    );
    const signature = base64url(crypto.sign("RSA-SHA256", Buffer.from(`${header}.${claim}`), privateKey));

    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion: `${header}.${claim}.${signature}`,
        }),
    });

    const data = await response.json();
    if (!data.access_token) throw new Error(`token request failed: ${JSON.stringify(data)}`);
    return data.access_token;
}

export async function sheetsGet(token, spreadsheetId, suffix) {
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${suffix}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Sheets API ${response.status}: ${await response.text()}`);
    return response.json();
}

export async function getValues(token, spreadsheetId, sheet, a1, query = "") {
    const range = encodeURIComponent(`'${sheet}'!${a1}`);
    const data = await sheetsGet(token, spreadsheetId, `/values/${range}${query}`);
    return data.values ?? [];
}

async function sheetsSend(token, spreadsheetId, suffix, method, body) {
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${suffix}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Sheets API ${response.status}: ${await response.text()}`);
    return response.json();
}

/** RAW by default: plates, phones and NUITs must land exactly as given. */
export async function setValues(token, spreadsheetId, sheet, a1, values, valueInputOption = "RAW") {
    const range = encodeURIComponent(`'${sheet}'!${a1}`);
    return sheetsSend(token, spreadsheetId, `/values/${range}?valueInputOption=${valueInputOption}`, "PUT", {
        values,
    });
}

export async function batchUpdate(token, spreadsheetId, requests) {
    return sheetsSend(token, spreadsheetId, ":batchUpdate", "POST", { requests });
}
