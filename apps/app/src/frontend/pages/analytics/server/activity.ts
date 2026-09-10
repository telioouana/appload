import type { ActivityCatalog } from "@workspace/trpc/activity-log";

// Display-safe params for the analytics mutations (scalar whitelist, see src/backend/api/activity-catalog.ts).
export const analyticsCatalog: ActivityCatalog = {};
