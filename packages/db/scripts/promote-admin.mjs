/**
 * Promotes a staff user to the platform "admin" role — the first-admin
 * bootstrap for a fresh database, where every user starts with no role and
 * therefore the lowest access.
 *
 * The user must already exist: Google sign-in with an @apploadafrica.com
 * account creates a valid staff row (type "appload"), and this script only
 * flips its role. It never fabricates users or Better Auth account rows.
 *
 * Usage:
 *   node packages/db/scripts/promote-admin.mjs someone@apploadafrica.com
 * (reads DATABASE_URL from apps/admin/.env or the environment — export a
 * production DATABASE_URL to promote in production)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function databaseUrl() {
    if (process.env.DATABASE_URL) {
        return process.env.DATABASE_URL;
    }

    const env = fs.readFileSync(path.join(root, "apps/admin/.env"), "utf8");
    const match = env.match(/^DATABASE_URL=(.+)$/m);

    if (!match) {
        throw new Error("DATABASE_URL not found in apps/admin/.env or the environment");
    }

    return match[1].trim();
}

const email = process.argv[2];

if (!email || !email.includes("@")) {
    console.error("Usage: node packages/db/scripts/promote-admin.mjs <email>");
    process.exit(1);
}

const sql = neon(databaseUrl());

const rows = await sql`
    update "user"
    set "role" = 'admin'
    where "email" = ${email.toLowerCase()} and "type" = 'appload'
    returning "id", "name", "email"
`;

if (rows.length === 0) {
    console.error(
        `No staff user found for ${email}. Sign in with Google (an @apploadafrica.com account) first, then re-run this script.`,
    );
    process.exit(1);
}

console.log(`Promoted ${rows[0].name} <${rows[0].email}> to admin.`);
