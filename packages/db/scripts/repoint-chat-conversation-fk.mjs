/**
 * Repoints chat_conversation.order_id from the near-dead "ops_order" table
 * to the live "order" table (both key on the human order id). Steps:
 *   1. report conversations whose order_id has no row in "order" and null
 *      them (they would violate the new FK)
 *   2. drop the FK to ops_order
 *   3. add the FK to "order"(order_id)
 * Idempotent: skips work already done.
 *
 * Must stay in sync with packages/db/src/schemas/chats.ts.
 *
 * Usage:
 *   node packages/db/scripts/repoint-chat-conversation-fk.mjs
 * (reads DATABASE_URL from apps/admin/.env or the environment)
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

const sql = neon(databaseUrl());

// Current FKs on chat_conversation.order_id, with their referenced table
const constraints = await sql`
    select con.conname, rel.relname as referenced_table
    from pg_constraint con
    join pg_class src on src.oid = con.conrelid
    join pg_class rel on rel.oid = con.confrelid
    where src.relname = 'chat_conversation'
      and con.contype = 'f'
      and 'order_id' = any (
          select attname from pg_attribute
          where attrelid = con.conrelid and attnum = any (con.conkey)
      )`;

const alreadyRepointed = constraints.some((c) => c.referenced_table === "order");

if (alreadyRepointed) {
    console.log("chat_conversation.order_id already references \"order\" — nothing to do");
    process.exit(0);
}

// 1. Orphans against the live "order" table lose their link (logged)
const orphans = await sql`
    select id, order_id from chat_conversation
    where order_id is not null
      and order_id not in (select order_id from "order")`;

if (orphans.length > 0) {
    console.log(`nulling ${orphans.length} conversation link(s) with no matching "order" row:`);
    console.table(orphans);
    await sql`
        update chat_conversation set order_id = null
        where order_id is not null
          and order_id not in (select order_id from "order")`;
} else {
    console.log("no orphaned conversation links");
}

// 2. Drop the old FK(s) — constraint names are dynamic, so sql.query
for (const constraint of constraints) {
    console.log(`dropping FK ${constraint.conname} (→ ${constraint.referenced_table})`);
    await sql.query(`alter table chat_conversation drop constraint "${constraint.conname}"`);
}

// 3. Add the new FK
await sql`
    alter table chat_conversation
    add constraint "chat_conversation_order_id_order_order_id_fk"
    foreign key ("order_id") references "order"("order_id")`;

console.log("chat_conversation.order_id now references \"order\"(order_id)");
