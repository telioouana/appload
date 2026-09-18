/**
 * Seeds Appload's own `organization` row.
 *
 * Appload is a partner like any transporter: a load handed to it names an
 * organization, and that organization needs a row. It is the one row with
 * `type = 'appload'` — a fixed id ("appload"), `status active`,
 * `kyc_status verified` and `portal_activated_at` set so the linking code
 * treats it as being on the portal.
 *
 * It NEVER gets a `member`: nobody signs in as Appload, staff work in the
 * admin. `packages/trpc/src/tenant-gate.ts` denies a membership of a
 * non-partner organization type, so a stray one would be locked out anyway.
 *
 * `insert … on conflict (id) do update`, so running it twice is a no-op and
 * re-running it after sync-dev-from-logbook.mjs (which truncates
 * `organization`, and calls seedAppload below in its epilogue) is the fix.
 *
 * The identity fields are placeholders on dev. Production passes Claire's
 * real ones — `nuit`, `email` and `phone_number` are unique columns and the
 * NUIT is on every invoice:
 *   node packages/db/scripts/seed-appload-organization.mjs \
 *       --nuit=400123456 --email=geral@apploadafrica.com --phone=+258840000000 --yes
 *
 * Usage:
 *   node packages/db/scripts/seed-appload-organization.mjs [--yes] [--nuit=…] [--email=…] [--phone=…]
 *
 *   (no flag)   dry run — report what would be written and write nothing
 *   --yes       write
 * (reads DATABASE_URL from apps/admin/.env or the environment)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { neon } from "@neondatabase/serverless";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Must stay in sync with APPLOAD_ORG_ID / APPLOAD_ORG_NAME in packages/db/src/types/index.ts */
export const APPLOAD_ORG_ID = "appload";
export const APPLOAD_ORG_NAME = "Appload";

/** Placeholders: unique, obviously not real, and shaped like the real thing. */
export const DEV_IDENTITY = {
    nuit: "400000000",
    email: "appload@apploadafrica.dev",
    phone: "+258800000000",
};

/** The upsert itself, so sync-dev-from-logbook.mjs can re-run it after its wipe. */
export async function seedAppload(sql, identity = DEV_IDENTITY) {
    await sql`
        insert into "organization" (
            "id", "name", "slug", "created_at", "nuit", "type", "status",
            "email", "phone_number", "kyc_status", "portal_activated_at"
        ) values (
            ${APPLOAD_ORG_ID}, ${APPLOAD_ORG_NAME}, 'appload', now(), ${identity.nuit}, 'appload', 'active',
            ${identity.email}, ${identity.phone}, 'verified', now()
        )
        on conflict ("id") do update set
            "name" = excluded."name",
            "slug" = excluded."slug",
            "nuit" = excluded."nuit",
            "type" = excluded."type",
            "status" = excluded."status",
            "email" = excluded."email",
            "phone_number" = excluded."phone_number",
            "kyc_status" = excluded."kyc_status",
            "portal_activated_at" = coalesce("organization"."portal_activated_at", excluded."portal_activated_at")`;
}

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

// Imported by the logbook sync for seedAppload alone; only a direct run does
// the reporting and the flags below
const isMain = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
    const ASSUME_YES = process.argv.includes("--yes");

    const flag = (name, fallback) => {
        const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
        return match ? match.slice(name.length + 3).trim() : fallback;
    };

    const identity = {
        nuit: flag("nuit", DEV_IDENTITY.nuit),
        email: flag("email", DEV_IDENTITY.email),
        phone: flag("phone", DEV_IDENTITY.phone),
    };

    if (!/^\d{9}$/.test(identity.nuit)) {
        throw new Error(`--nuit must be 9 digits, got "${identity.nuit}"`);
    }

    const url = databaseUrl();
    const sql = neon(url);
    const databaseName = decodeURIComponent(new URL(url).pathname.slice(1)).split("?")[0];

    console.log(`database: ${databaseName}`);
    console.log(ASSUME_YES ? "mode:     WRITE" : "mode:     DRY RUN — nothing is written");
    console.log(`row:      id=${APPLOAD_ORG_ID} name=${APPLOAD_ORG_NAME} nuit=${identity.nuit} email=${identity.email} phone=${identity.phone}\n`);

    const [existing] = await sql`
        select "id", "name", "type", "status", "kyc_status", "nuit", "email", "phone_number", "portal_activated_at"
        from "organization"
        where "id" = ${APPLOAD_ORG_ID}`;

    if (existing) {
        console.log("already seeded — the row below is updated in place:");
        console.table([existing]);
    } else {
        console.log("no Appload organization yet — it will be inserted");
    }

    // A member would let somebody sign in as Appload; there is never one
    const [{ members }] = await sql`select count(*)::int as members from "member" where "organization_id" = ${APPLOAD_ORG_ID}`;

    if (members > 0) {
        throw new Error(`refusing to run: ${members} member row(s) point at the Appload organization — Appload has no members`);
    }

    if (!ASSUME_YES) {
        console.log("\nRe-run with --yes to write.");
        process.exit(0);
    }

    await seedAppload(sql, identity);

    const [row] = await sql`
        select "id", "name", "slug", "type", "status", "kyc_status", "nuit", "email", "phone_number", "portal_activated_at"
        from "organization"
        where "id" = ${APPLOAD_ORG_ID}`;

    console.log("\nseeded:");
    console.table([row]);
}
