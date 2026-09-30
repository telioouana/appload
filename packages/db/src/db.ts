import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@workspace/db/schema";

type Db = PostgresJsDatabase<typeof schema>;

/**
 * One client for one connection string. Which role that string names is the
 * whole trust wall (schemas/rls.ts): the portal's is the table owner, the
 * admin's is `appload_staff`, the webhook's is `appload_service`.
 */
export function createDb(connectionString: string): Db {
    // prepare: false — Supabase's transaction pooler (port 6543) hands every
    // transaction a different backend, so a prepared statement is not there
    // the next time it is used
    return drizzle(postgres(connectionString, { prepare: false, idle_timeout: 20 }), { schema });
}

let _db: Db | null = null;

export function getDb() {
    if (_db) return _db;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL is not set");
    }

    _db = createDb(connectionString);
    return _db;
}

export const db = new Proxy({} as Db, {
    get: (_, prop) => getDb()[prop as keyof Db],
});

let _serviceDb: Db | null = null;

/**
 * The connection the Infobip webhook and the admin's crons run on: nobody is
 * signed in, and a driver's ping has to be routed to whichever company's
 * load he is on, so this role reads every row of the few tables it is
 * granted. Without SERVICE_DATABASE_URL it is `db` itself — the portal, the
 * scripts and a machine without the roles behave as before.
 */
export function getServiceDb() {
    const connectionString = process.env.SERVICE_DATABASE_URL;
    if (!connectionString) return getDb();
    if (_serviceDb) return _serviceDb;

    _serviceDb = createDb(connectionString);
    return _serviceDb;
}

export const serviceDb = new Proxy({} as Db, {
    get: (_, prop) => getServiceDb()[prop as keyof Db],
});
