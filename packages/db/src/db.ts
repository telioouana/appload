import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@workspace/db/schema";

let _db: PostgresJsDatabase<typeof schema> | null = null;

export function getDb() {
    if (_db) return _db;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL is not set");
    }

    // prepare: false — Supabase's transaction pooler (port 6543) hands every
    // transaction a different backend, so a prepared statement is not there
    // the next time it is used
    _db = drizzle(postgres(connectionString, { prepare: false, idle_timeout: 20 }), { schema });
    return _db;
}

export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
    get: (_, prop) => getDb()[prop as keyof PostgresJsDatabase<typeof schema>],
});
