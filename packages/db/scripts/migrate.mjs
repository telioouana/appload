/**
 * Applies pending migrations from ./drizzle over Neon's HTTP driver — the
 * same journal and folder drizzle-kit uses, but with real error output
 * (drizzle-kit's websocket path exits 1 silently on some environments).
 * Reads DATABASE_URL from packages/db/.env like drizzle.config.ts does.
 *
 * Usage: node scripts/migrate.mjs   (from packages/db)
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

try {
    process.loadEnvFile(".env");
} catch {
    // .env missing — rely on the environment
}

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set (packages/db/.env or environment)");
}

const db = drizzle(neon(process.env.DATABASE_URL));

await migrate(db, { migrationsFolder: "./drizzle" });

console.log("migrations applied");
