/**
 * The scripts' database client: postgres.js behind the two call shapes the
 * scripts were written against — the tagged template and `sql.query(text,
 * params)` — so moving off Neon's HTTP driver changed one import per script.
 */
import postgres from "postgres";

const pad = (value, length = 2) => String(value).padStart(length, "0");

/**
 * A Date the way Neon's driver sent it: local wall time with its offset.
 * postgres.js sends UTC, which a `timestamp` column stores as is — every
 * sheet date written at local midnight would land on the evening before.
 */
function localDate(date) {
    const offset = -date.getTimezoneOffset();
    const sign = offset < 0 ? "-" : "+";

    return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
        + `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

const param = (value) => (value instanceof Date ? localDate(value) : value);

export function connect(url) {
    // prepare: false for Supabase's transaction pooler; the short idle timeout
    // lets a script exit by itself once its last query is done
    const client = postgres(url, { prepare: false, idle_timeout: 1, onnotice: () => {} });

    // Date text goes out as the script wrote it. postgres.js would re-read
    // "2024-10-28 00:00:00" as local time and send it as UTC (what drizzle's
    // own postgres-js driver switches off too)
    for (const type of [1082, 1083, 1114, 1184]) {
        client.options.serializers[type] = (value) => value;
    }

    const sql = (strings, ...values) => client(strings, ...values.map(param));
    sql.query = (text, params = []) => client.unsafe(text, params.map(param));

    return sql;
}

// node packages/db/scripts/sql.mjs — the one thing here that can be wrong
if (process.argv[1]?.endsWith("sql.mjs")) {
    const text = localDate(new Date(2024, 9, 28, 0, 0, 0, 0));

    if (!text.startsWith("2024-10-28T00:00:00.000") || new Date(text).getTime() !== new Date(2024, 9, 28).getTime()) {
        throw new Error(`localDate is wrong: ${text}`);
    }

    console.log("ok", text);
}
