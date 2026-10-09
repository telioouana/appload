// Pages of the merged list, read one after another, must be the merged list — for every sort and page size.
import { mergePage, windowFor } from "@/frontend/pages/movements/server/standing-orders";

type Row = Parameters<typeof mergePage>[0]["window"][number];

const day = (n: number | null) => (n === null ? null : new Date(2026, 0, n));
const row = (id: string, created: number, loading: number | null, delivery: number | null): Row =>
    ({ id, createdAt: day(created), expectedLoadingDate: day(loading), expectedDeliveryAt: day(delivery) }) as unknown as Row;

// 23 trips with a few null dates, 4 standing orders, some ties on dates
const trips = Array.from({ length: 23 }, (_, i) => row(`t${i}`, 100 - i * 3, i % 5 === 0 ? null : 50 + (i % 7) * 2, i % 4 === 0 ? null : 60 + i));
const standing = [row("s1", 95, 52, null), row("s2", 70, null, 64), row("s3", 10, 50, 61), row("s4", 101, 62, 90)];

const key = (sort: string, r: Row) => sort === "loading" ? r.expectedLoadingDate : sort === "delivery" ? r.expectedDeliveryAt : r.createdAt;
const compare = (sort: string, dir: string) => (a: Row, b: Row) => {
    const ka = key(sort, a), kb = key(sort, b);
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    const d = ka.getTime() - kb.getTime();
    return dir === "desc" ? -d : d;
};

let failures = 0;
for (const sort of ["newest", "loading", "delivery"] as const) {
    for (const dir of ["desc", "asc"] as const) {
        const cmp = compare(sort, dir);
        // The trips as SQL would hand them: sorted by the key, ties by a stable secondary (here, input order)
        const sortedTrips = [...trips].sort((a, b) => cmp(a, b));
        for (const pageSize of [5, 10, 25]) {
            const seen: string[] = [];
            const pages = Math.ceil((trips.length + standing.length) / pageSize);
            for (let page = 1; page <= pages; page++) {
                const { offset, limit } = windowFor({ page, pageSize }, standing.length);
                const window = sortedTrips.slice(offset, offset + limit);
                const result = mergePage({ window, windowOffset: offset, movementTotal: trips.length, standing, sort, dir, page, pageSize });
                if (result.total !== trips.length + standing.length) failures++, console.log("total", sort, dir, pageSize, result.total);
                seen.push(...result.items.map((r) => r.id));
            }
            const ids = new Set(seen);
            const ok = seen.length === trips.length + standing.length && ids.size === seen.length
                // Every neighbour pair in page order respects the key order
                && seen.every((id, i) => i === 0 || cmp(find(seen[i - 1]!), find(id)) <= 0);
            if (!ok) failures++, console.log("FAIL", sort, dir, pageSize, seen.length, ids.size, seen.join(","));
        }
    }
}

function find(id: string): Row { return [...trips, ...standing].find((r) => r.id === id)!; }

console.log(failures === 0 ? "merge ok: every page sequence is the merged list, no row lost or doubled" : `${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
