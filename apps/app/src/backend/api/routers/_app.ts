import { createTRPCRouter } from "@workspace/trpc/init"
import { registerActivityCatalog } from "@workspace/trpc/activity-log"

import { activityCatalog } from "../activity-catalog"
import { meRouter } from "@/frontend/pages/settings/server/procedures"
import { onboardingRouter } from "@/frontend/pages/onboarding/server/procedures"

// Module scope: runs on every cold start before any request is handled, so
// mutation log rows get their enriched params from the first request on
registerActivityCatalog(activityCatalog);

export const appRouter = createTRPCRouter({
    me: meRouter,
    onboarding: onboardingRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
