import { drizzle } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import * as schema from "@workspace/db/schema";

let _db: NeonHttpDatabase<typeof schema> | null = null;

export function getDb() {
    if (_db) return _db;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL is not set");
    }

    _db = drizzle(connectionString, { schema });
    return _db;
}

export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
    get: (_, prop) => getDb()[prop as keyof NeonHttpDatabase<typeof schema>],
});