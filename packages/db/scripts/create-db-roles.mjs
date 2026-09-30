/**
 * Creates the two connection roles behind the trust wall
 * (packages/db/src/schemas/rls.ts) and grants them their tables.
 *
 *   appload_staff    the admin app. Every table, every sequence, and the
 *                    same on tables created later (default privileges) —
 *                    row security is the wall, not the grants.
 *   appload_service  the Infobip webhook and the admin's crons. Only the
 *                    tables those code paths touch; anything else is
 *                    "permission denied", which is the point.
 *
 * Roles are cluster-wide and grants are per database, so this runs once
 * against appload-dev and once against appload-prod, as the OWNER
 * (`postgres.<ref>`). Idempotent: an existing role gets its password reset
 * when one is given and its grants re-applied.
 *
 * Passwords come from the environment, never from argv (argv shows up in
 * the process list). Letters, digits, `-` and `_` only — they are spliced
 * into DDL, which takes no parameters.
 *
 * Usage:
 *   STAFF_DB_PASSWORD=… SERVICE_DB_PASSWORD=… node packages/db/scripts/create-db-roles.mjs [--yes]
 *
 *   (no flag)   dry run — report what would be done and do nothing
 *   --yes       do it
 * (reads DATABASE_URL from packages/db/.env or the environment)
 *
 * The connection strings for the two apps are then the owner's with the
 * user swapped: postgresql://appload_staff.<ref>:<password>@<pooler>/<database>
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connect } from "./sql.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const yes = process.argv.includes("--yes");

/** What the webhook and the admin crons read and write. Keep in step with rls.ts. */
const SERVICE_TABLES = [
    // Infobip webhook: driver chats, delivery reports, pings on orders and loads
    "chat_conversation", "chat_message", "tracking_request",
    "order", "order_location",
    "movement", "movement_tracking_request", "movement_location", "movement_route",
    // sheet-sync cron
    "order_document", "order_history", "sheet_sync",
    // kyc-expiry cron
    "kyc_document", "organization", "driver", "truck", "trailer", "link",
    // notify(): who to tell and the rows that tell them
    "member", "user", "notification",
];

function databaseUrl() {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

    const env = fs.readFileSync(path.join(root, "packages/db/.env"), "utf8");
    const match = env.match(/^DATABASE_URL=(.+)$/m);
    if (!match) throw new Error("DATABASE_URL not found in packages/db/.env or the environment");

    return match[1].trim();
}

function password(name) {
    const value = process.env[name];
    if (value === undefined) return null;
    if (!/^[A-Za-z0-9_-]{16,}$/.test(value)) {
        throw new Error(`${name} must be at least 16 characters of letters, digits, - and _`);
    }
    return value;
}

const quoted = (table) => `"${table}"`;

async function ensureRole(sql, role, pw) {
    const [existing] = await sql`select 1 from pg_roles where rolname = ${role}`;

    if (!existing) {
        if (!pw) throw new Error(`${role} does not exist and no password was given to create it`);
        console.log(`create role ${role}`);
        if (yes) await sql.query(`create role ${role} login password '${pw}' nobypassrls`);
        return;
    }

    console.log(`role ${role} exists${pw ? ", password reset" : ""}`);
    if (yes && pw) await sql.query(`alter role ${role} password '${pw}'`);
}

async function main() {
    const url = databaseUrl();
    const sql = connect(url);
    const [{ current_database: database, current_user: user }] = await sql`select current_database(), current_user`;
    console.log(`${yes ? "applying to" : "dry run against"} ${database} as ${user}`);

    const [owner] = await sql`select rolbypassrls from pg_roles where rolname = current_user`;
    if (!owner?.rolbypassrls) {
        throw new Error("run this as the table owner (postgres.<ref>), the role that bypasses row security");
    }

    await ensureRole(sql, "appload_staff", password("STAFF_DB_PASSWORD"));
    await ensureRole(sql, "appload_service", password("SERVICE_DB_PASSWORD"));

    const missing = [];
    for (const table of SERVICE_TABLES) {
        const [row] = await sql`select to_regclass(${`public.${quoted(table)}`}) as oid`;
        if (!row?.oid) missing.push(table);
    }
    if (missing.length > 0) throw new Error(`service tables not in this database: ${missing.join(", ")}`);

    const statements = [
        // staff: everything, now and later
        `grant usage on schema public to appload_staff`,
        `grant all on all tables in schema public to appload_staff`,
        `grant usage, select on all sequences in schema public to appload_staff`,
        `alter default privileges in schema public grant all on tables to appload_staff`,
        `alter default privileges in schema public grant usage, select on sequences to appload_staff`,
        // service: the short list, and sequences for the inserts it makes
        `grant usage on schema public to appload_service`,
        `revoke all on all tables in schema public from appload_service`,
        `grant select, insert, update on ${SERVICE_TABLES.map(quoted).join(", ")} to appload_service`,
        `grant usage, select on all sequences in schema public to appload_service`,
    ];

    for (const statement of statements) {
        console.log(statement.length > 120 ? `${statement.slice(0, 117)}…` : statement);
        if (yes) await sql.query(statement);
    }

    const roles = await sql`
        select r.rolname, r.rolbypassrls, r.rolcanlogin,
               (select count(*) from information_schema.role_table_grants g
                 where g.grantee = r.rolname and g.table_schema = 'public' and g.privilege_type = 'SELECT') as tables_readable
          from pg_roles r where r.rolname in ('appload_staff', 'appload_service') order by 1`;
    console.table(roles);

    if (!yes) console.log("dry run — nothing was changed; re-run with --yes");
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
