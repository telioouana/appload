import { defineConfig } from "drizzle-kit";

// Load DATABASE_URL from packages/db/.env (Node 20.12+ built-in, no dotenv dependency)
try {
    process.loadEnvFile(".env");
} catch {
    // .env missing — rely on the environment
}

export default defineConfig({
    schema: "./src/schema.ts",
    dialect: "postgresql",
    out: "./drizzle",
    dbCredentials: {
        url: process.env.DATABASE_URL!,
    },
});
