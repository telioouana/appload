/**
 * Applies pending migrations from ./drizzle — the same journal and folder
 * drizzle-kit uses, but with real error output (drizzle-kit exits 1 silently
 * on some environments).
 * Reads DATABASE_URL from packages/db/.env like drizzle.config.ts does.
 *
 * Usage: node scripts/migrate.mjs   (from packages/db)
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

try {
    process.loadEnvFile(".env");
} catch {
    // .env missing — rely on the environment
}

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set (packages/db/.env or environment)");
}

const client = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });

await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
await client.end();

console.log("migrations applied");
