/**
 * One-time adoption of drizzle-kit migrations on a database whose schema
 * was originally applied with `db:push`: the schema exists but
 * drizzle.__drizzle_migrations is empty, so `db:migrate` tries to re-run
 * migration 0000 and fails on "already exists".
 *
 * Marks the already-applied migrations (everything up to BASELINE_THROUGH)
 * as applied — same table shape, hash, and timestamps the migrator itself
 * writes — without executing their SQL. Refuses to touch a non-empty
 * journal. After this, `node scripts/migrate.mjs` applies only the newer
 * migrations for real.
 *
 * Usage: node scripts/baseline-journal.mjs   (from packages/db)
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const BASELINE_THROUGH = 6;

try {
    process.loadEnvFile(".env");
} catch {
    // .env missing — rely on the environment
}

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set (packages/db/.env or environment)");
}

const sql = neon(process.env.DATABASE_URL);

await sql.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
await sql.query(`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
)`);

const existing = await sql.query(`SELECT id, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at`);
const rows = existing.rows ?? existing;

if (rows.length > 0) {
    console.error(`journal already has ${rows.length} entries — refusing to baseline. Inspect it first.`);
    process.exit(1);
}

const journal = JSON.parse(readFileSync("./drizzle/meta/_journal.json", "utf8"));
const entries = journal.entries.filter((entry) => entry.idx <= BASELINE_THROUGH);

for (const entry of entries) {
    const content = readFileSync(`./drizzle/${entry.tag}.sql`, "utf8");
    const hash = createHash("sha256").update(content).digest("hex");

    await sql.query(
        `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
        [hash, entry.when],
    );

    console.log(`baselined ${entry.tag} (${entry.when})`);
}

console.log(`journal baselined through idx ${BASELINE_THROUGH} — run scripts/migrate.mjs to apply the rest`);
