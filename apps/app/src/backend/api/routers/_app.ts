import { createTRPCRouter } from "@workspace/trpc/init"
import { registerActivityCatalog } from "@workspace/trpc/activity-log"

import { activityCatalog } from "../activity-catalog"
import { analyticsCatalog } from "@/frontend/pages/analytics/server/activity"
import { analyticsRouter } from "@/frontend/pages/analytics/server/procedures"
import { driversCatalog } from "@/frontend/pages/drivers/server/activity"
import { driversRouter } from "@/frontend/pages/drivers/server/procedures"
import { fleetCatalog } from "@/frontend/pages/fleet/server/activity"
import { fleetRouter } from "@/frontend/pages/fleet/server/procedures"
import { mapCatalog } from "@/frontend/pages/map/server/activity"
import { mapRouter } from "@/frontend/pages/map/server/procedures"
import { movementsCatalog } from "@/frontend/pages/movements/server/activity"
import { movementsRouter } from "@/frontend/pages/movements/server/procedures"
import { notificationsCatalog } from "@/frontend/pages/notifications/server/activity"
import { notificationsRouter } from "@/frontend/pages/notifications/server/procedures"
import { onboardingRouter } from "@/frontend/pages/onboarding/server/procedures"
import { ordersCatalog } from "@/frontend/pages/orders/server/activity"
import { ordersRouter } from "@/frontend/pages/orders/server/procedures"
import { partnersCatalog } from "@/frontend/pages/partners/server/activity"
import { partnersRouter } from "@/frontend/pages/partners/server/procedures"
import { quotesCatalog } from "@/frontend/pages/quotes/server/activity"
import { quotesRouter } from "@/frontend/pages/quotes/server/procedures"
import { meRouter } from "@/frontend/pages/settings/server/procedures"

// Module scope: runs on every cold start before any request is handled, so
// mutation log rows get their enriched params from the first request on.
// Each feature owns its catalog next to its router; the core one (onboarding,
// me) lives in ../activity-catalog.
registerActivityCatalog({
    ...activityCatalog,
    ...analyticsCatalog,
    ...driversCatalog,
    ...fleetCatalog,
    ...mapCatalog,
    ...movementsCatalog,
    ...notificationsCatalog,
    ...ordersCatalog,
    ...partnersCatalog,
    ...quotesCatalog,
});

export const appRouter = createTRPCRouter({
    analytics: analyticsRouter,
    drivers: driversRouter,
    fleet: fleetRouter,
    map: mapRouter,
    me: meRouter,
    movements: movementsRouter,
    notifications: notificationsRouter,
    onboarding: onboardingRouter,
    orders: ordersRouter,
    partners: partnersRouter,
    quotes: quotesRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
