import { desc, eq } from "drizzle-orm";

import { db } from "@workspace/db/db";
import {
    activityLog,
    type ActivityParams,
    type CreateActivityLog,
} from "@workspace/db/activity-log";

// A session counts as "resumed" when the first authenticated request arrives
// after this much logged inactivity
const RESUME_GAP_MS = 30 * 60 * 1000;

export type ActivityExtractor = {
    // output is undefined when the mutation failed — extractors must tolerate it.
    // `any` (not `unknown`) so catalog entries can annotate narrower
    // input/output types without tripping strictFunctionTypes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entity?: (input: any, output: any) => { type: string; id: string } | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params?: (input: any, output: any) => ActivityParams;
};

export type ActivityCatalog = Record<string, ActivityExtractor>;

let catalog: ActivityCatalog = {};

// Called at module scope when the app router is assembled, so it runs on
// every cold start before any request is handled. Uncatalogued mutations
// still get a generic log row.
export function registerActivityCatalog(entries: ActivityCatalog) {
    catalog = { ...catalog, ...entries };
}

type SessionCtx = {
    user: { id: string; name: string };
    session: {
        id: string;
        ipAddress?: string | null;
        userAgent?: string | null;
        city?: string | null;
        country?: string | null;
        activeOrganizationId?: string | null;
    };
};

export async function recordRequestActivity(opts: {
    session: SessionCtx;
    path: string;
    type: string; // "mutation" | "query" | "subscription"
    rawInput: unknown; // only fetched for mutations
    ok: boolean;
    output: unknown; // undefined when !ok or for queries
    errorCode?: string; // TRPCError code
    errorMessage?: string; // domain code, e.g. "TRUCK_NOT_REGISTERED"
}) {
    const { session } = opts;
    const base = {
        actorId: session.user.id,
        actorName: session.user.name,
        sessionId: session.session.id,
        organizationId: session.session.activeOrganizationId ?? null,
        ipAddress: session.session.ipAddress ?? null,
        userAgent: session.session.userAgent ?? null,
        city: session.session.city ?? null,
        country: session.session.country ?? null,
    } satisfies Partial<CreateActivityLog>;

    // Heartbeat: mark the session as resumed when the last logged row is
    // stale. Queries participate here even though they are never logged as
    // actions themselves.
    const [last] = await db
        .select({ createdAt: activityLog.createdAt })
        .from(activityLog)
        .where(eq(activityLog.sessionId, session.session.id))
        .orderBy(desc(activityLog.createdAt))
        .limit(1);

    if (!last || Date.now() - last.createdAt.getTime() > RESUME_GAP_MS) {
        await db.insert(activityLog).values({ ...base, action: "session.resumed" });
    }

    if (opts.type !== "mutation") return;

    const extractor = catalog[opts.path];
    let entityType: string | null = null;
    let entityId: string | null = null;
    let params: ActivityParams = {};

    // An extractor bug must never break logging, let alone the mutation
    try {
        const entity = extractor?.entity?.(opts.rawInput, opts.output) ?? null;
        entityType = entity?.type ?? null;
        entityId = entity?.id ?? null;
        params = extractor?.params?.(opts.rawInput, opts.output) ?? {};
    } catch (error) {
        console.error(`[activity-log] extractor failed for ${opts.path}`, error);
    }

    await db.insert(activityLog).values({
        ...base,
        action: opts.path,
        entityType,
        entityId,
        params,
        status: opts.ok ? "success" : "error",
        errorCode: opts.ok
            ? null
            : [opts.errorCode, opts.errorMessage].filter(Boolean).join(":"),
    });
}
