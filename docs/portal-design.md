# Appload Partner Portal (`apps/app`) — Technical Plan

_Phase 1 deliverable (Fable 5.1). Phase 2 (implementation, Opus 5 Ultracode) starts only after approval._
_Grounded in the codebase as of 2026-09-09 (branch `dev`, last commit `faf2caa`) and ten subsystem reads under `apps/admin`, `packages/*`, `RELEASE.md`._

> **Superseded in part (2026-09-10/11, branch `stage/22-portal`).** The portal was redesigned to be the company's own operations hub rather than a front end onto Appload's brokerage. What changed against this document:
>
> - **The company's own loads are a `movement` table** (migration `0016_movements`, which replaces the `trip` tables below): a *Trip* when its own fleet moves the load, an *Order* when a partner does for an agreed price, one row either way so a trip handed to a partner keeps its number, address and trail. Both money legs (what it charges, what it pays), cost lines, papers by audience and an event trail. The first status is `procurement`. None of it reaches the admin, the logbook, the KPIs or the commission. Doors in `packages/domain/src/movements`, the three-role projection (owner / executor / client) in `apps/app/src/frontend/pages/movements/server/projection.ts`.
> - **Partners on the portal are offered loads and answer them**; accepting creates the partner's own row linked below the order, whose tracking and proof of delivery flow up. Only the row with the truck is pinged (§ tracking and the Infobip attribution now filter on it).
> - **Routes:** `/orders/[section]` and `/trips/[section]` are the company's own lists, `/orders/load/[loadId]` the one load page; Appload's brokerage (orders, offers, quotes — §§ below, unchanged in behaviour) moved to `/appload/*`. `/trips/[tripId]` is gone.
> - **Fleet and drivers are open to shippers** (no KYC for their assets; the admin's Owner filter defaults to carriers), the rail takes the admin's structure, and the UI both apps shared by copy now lives in `packages/ui/src/customs`.
> - Notification kinds `trip.*` became `movement.*`; `claim.rejected` was dropped and `member.joined` has a writer.
>
> The sections below still describe the brokerage, onboarding, subscriptions and notifications accurately except where these points say otherwise. Regression script for the new model: `apps/app/scripts/verify-movements.ts`.

---

## Context

Appload's operations run in `apps/admin`, a staff-only Next.js 16 app (tRPC v11, Better Auth 1.6, Drizzle on Neon, next-intl pt/en, EdgeStore, Infobip WhatsApp/SMS, QStash cron, Google Maps). Shippers ("Clients") and carriers ("Transporters") exist only as rows in `organization` with no login. The goal is a **multi-tenant, subscription-based portal in the empty `apps/app` directory** where those companies manage partner connections, fleet, direct orders and quotes, trip tracking (including trips already in transit registered by driver phone only), analytics, and an in-app notification center — on the **same database**, so Appload ops keep full visibility in Admin.

Decisions confirmed with Claire (2026-09-09):

| Topic | Decision |
|---|---|
| Commission on portal deals | **None.** Portal offers are priced with `commissionTotal = 0`; client price = carrier price with the existing VAT rules. Staff can still re-price in Admin. |
| Onboarding | **Self-serve + staff approval.** Unknown NUIT → organization created at sign-up. Known NUIT with no members → claim approved by staff in Admin; auto-approved when the verified sign-up email equals the organization's email on file. |
| Subscription | **Named tiers by monthly tracked movements** (revised 2026-09-10, see §4.1): no free plan; staff set the tier (starter/business/enterprise) and an expiry in Admin; the portal blocks booking, dispatch and trips when there is no active plan or the month's allowance is used up. No payments. |
| KYC | **Status badges only.** Uploads and review stay in Admin. |

Architectural decisions taken in this plan (rationale inline):

1. **One Better Auth instance, shared.** `auth` from `@workspace/auth/server` is mounted in the portal too. Sign-up goes through a tRPC procedure (server-side `auth.api.signUpEmail`) so `user.type` is never client-chosen; the portal's `/api/auth` route blocks only `POST /sign-up/email`. Google sign-in for partners is deferred (the shared provider hard-codes `type: "appload"`, `packages/auth/src/server.ts:302`).
2. **Tenant = organization; membership = Better Auth `member` rows** (roles `owner`/`admin`/`member` via `oac`). A new `tenantProcedure` in `packages/trpc` reads user + member + organization **live from the DB** per request (same rationale as `staff-gate.ts:16-19`). Every query predicate comes from `ctx.tenant`, never from input.
3. **Orders and quotes stay on the existing `order` / `order_offer` model.** Portal-originated orders are real orders (status `prospect`, `source` column), booked only by accepting a pending offer, exactly like Admin. Two small tables are added: `order_request` (a client sending an order to specific connected carriers) and `quote` (a carrier's unsolicited standing quote that becomes an order + accepted offer on acceptance).
4. **Business logic is extracted into shared packages, not copied.** Transitions, booking door, pricing, derivation, KYC verdicts, KPI SQL, tracking decisions and the map kit move from `apps/admin/src/lib` into `packages/domain`, `packages/comms`, `packages/maps`; Admin imports are rewired (behavior-preserving). UI-only pieces (the list kit, page shells) are **copied** into the portal.
5. **Standalone trips are a new `trip` entity** with its own location/tracking-request/route tables mirroring the order ones. Order-linked trips keep using the Admin pipeline unchanged. Admin's single Infobip webhook learns to attribute pins to trips (one small addition).
6. **Notifications are written explicitly by portal mutations** (same `db.batch` as the domain write) **plus a history-tailing materializer** for Admin-originated order events. Delivery to the UI is TanStack polling (30 s unread badge, 10 s while the panel is open) — the only shape Vercel Hobby's 60 s function cap supports; tRPC SSE is the documented upgrade path. Emails go through an outbox state on the notification row swept by a QStash cron.

---

## 1. System architecture

```
apps/admin  (staff)          apps/app  (partners, NEW, port 3001)
   │  authorizedProcedure       │  tenantProcedure
   │  (user.type = appload)     │  (member of organization, type shipper|carrier)
   └──────────┬─────────────────┴──────────────┐
              ▼                                ▼
  packages/trpc  (init, staff-gate, NEW tenant-gate, activity-log)
  packages/auth  (one Better Auth instance, oac + NEW statements, email)
  packages/domain (NEW: orders/, kyc/, kpis/, tracking/ — pure + DB helpers)
  packages/comms  (NEW: infobip adapter, phone, cron verify)
  packages/maps   (NEW: Google Routes server + React map kit)
  packages/db     (schemas + migration 0014 + dev scripts)
  packages/ui, packages/i18n, packages/edgestore (bucket rule widened)
              │
              ▼
  Neon Postgres (appload-dev / appload-prod)  ← one DB, two apps, one QStash, one Infobip sender
```

Runtime boundaries:

- **Isolation**: the portal never mounts an Admin router. Cross-tenant reads are allowed only through an `accepted` row in `partner_connection` and only for projected fields (name, province, KYC status, shared-order facts). Money is projected per leg: a shipper sees `shipper*` columns and `offer.client*`; a carrier sees `carrier*` and `offer.subtotal/vat/total`; `apploadCommission*` is never selected in the portal.
- **Staff sessions** (`user.type = appload`) are rejected by the portal gate with `NOT_PARTNER_ACCOUNT`; partner sessions are already rejected by Admin.
- **Sessions/cookies**: host-only cookies per origin, same `BETTER_AUTH_SECRET` (one env), no `COOKIE_DOMAIN`.

---

## 2. Shared packages (extraction, Milestone 0)

Admin behavior must not change; verified by `pnpm turbo lint typecheck build` plus the Admin smoke list in §12.

### 2.1 `packages/domain` (`@workspace/domain`)

| Subpath | Moved from `apps/admin/src/...` | Notes |
|---|---|---|
| `orders/transitions` | `lib/orders/transitions.ts` | unchanged; `StaffRole` import replaced by the actor type below |
| `orders/policy` | NEW | `TransitionActor` = `{kind:'staff', role}` \| `{kind:'tenant', organizationId, orgType}`; `allowedForActor(actor, order, target)` |
| `orders/transition` | `frontend/pages/order/server/procedures.ts` `transitionOrder` (651-924), `acceptOffer` (405-485), `transitionStamps`, `deriveResumeStatus`, `resumeFromHistory`, `startFollowUpChat`, plus `recordSheetSync` from `lib/orders/sheet-outbox.ts` | The one booking/transition door for both apps. `ctx` becomes `{db, actor, userId, waitUntil?, sheets: {push(order) => Promise<SheetResult>} \| "defer"}`. Admin passes its existing `pushOrderToSheets` (Google client, tokens and `sheets-client.ts` **stay in Admin**); the portal passes `"defer"`, which upserts `sheet_sync` pending so the existing cron heals the logbook. KYC gate: staff path unchanged; tenant path refuses in block mode, flags in warn mode, never acknowledges risk. Throws `TRPCError` as today (`@trpc/server` becomes a dependency of the package, as `lib/kyc/subjects.ts` already does). `server-only` markers are kept (`server-only` added as a dependency). |
| `orders/create` | `create` body (927-1063) minus Sheets id read | `createOrder(db, actor, input, {orderId, sheets})`; id from `nextOrderId(dbMaxSeq, sheetMaxSeq ?? 0, year)` + unique-index retry |
| `orders/commission`, `derive`, `totals`, `payments`, `milestones`, `order-id`, `booking-readiness`, `dispatch-readiness`, `carrier-snapshot`, `order-facts`, `predicates`, `errors` | same names under `lib/orders/` | `predicates.ts` takes the four status groupings from `frontend/pages/orders/types` → move `ORDER_STATUS_SECTION`, `PRE_LOADING/INTERRUPTED/PENDING_POD/UNBILLABLE/OUTSTANDING/ACTIVE_STATUSES`, `LOST_STATUSES` into `orders/status-groups` |
| `orders/schemas` | `backend/schemas/order.ts` + `offer.ts` **server variants only** (`CreateOrderSchemaServer`, `UpdateOrderSchemaServer`, `OfferValuesSchemaServer`, `OfferDecisionSchema`, `orderTo*Defaults`) | Translated client factories stay in each app (they are typed against app message namespaces) |
| `kyc/*` | `lib/kyc/{requirements,derive,eligibility,enforcement,subjects,order-gate,expiry,file-access}.ts` | `guardOrderGate` gains the actor type; `transitions.ts` (staff actions) stays in Admin |
| `kpis/*` | `lib/kpis/{compute,constants,fx}.ts`, `lib/metrics/fx.ts` (`fetchDailyRate`), the module-private SQL fragments of `frontend/pages/kpis/server/procedures.ts` (`leg`, `within`, `scope`, `FX`, `toUsd`, `aggregate`, `partyOrder`, …) and the pure date helpers of `kpis/types` | `aggregate()` gains a `tenant?: {orgId, orgType}` predicate and a `groupBy` decoupled from the money leg |
| `tracking/*` | `lib/tracking/{statuses,locations}.ts`, `lib/chats/conversations.ts`, `lib/tracking/run-slot.ts` pure parts (`currentSlotInfo`, `decideNextAttempt`, `hasOpenSession`, `smsText`, `place`) | `resolveOrderForConversation` gains a trip branch (§6.3) |

### 2.2 `packages/comms` (`@workspace/comms`)
`lib/chats/infobip.ts`, `lib/chats/phone.ts`, `lib/cron/verify.ts` (`authorizeCron`), `secretMatches` from the Infobip route. Reads the same `INFOBIP_*`, `QSTASH_*`, `CRON_SECRET` env.

### 2.3 `packages/maps` (`@workspace/maps`)
- `server`: `lib/maps/routes.ts` (`computeRoute(origin, destination)`) + the route-cache freshness helpers (`cacheKey`, TTLs, negative cache).
- `client`: `frontend/pages/map/{types,lib/geometry,lib/trail,lib/colors}.ts`, `components/{maps-provider,map-canvas,map-placeholder,markers,polyline,route-layer,use-fit-bounds}.tsx`. `MapPlaceholder` and legend labels take strings via props (no `Admin.map` coupling). `@vis.gl/react-google-maps` moves to this package; `transpilePackages` gains `@workspace/maps`.

### 2.4 `packages/trpc` additions
- `tenant-gate.ts`: `getTenantGates(db, {userId})` → `{ ok, reason?, userId, organizationId, orgType, orgStatus, role, emailVerified, plan: {plan, expiresAt, isPro} }`. Reads `user` (type, banned, status, emailVerified) and the user's `member` row (exactly one: `organizationLimit` is 1) joined to `organization` (type, status, subscriptionPlan, subscriptionExpiresAt). The session cookie's `activeOrganizationId` is **not** trusted for tenancy (it is null or stale for up to 5 minutes after `addMember`/`acceptInvitation`).
- `tenant.ts`: `tenantProcedure` (= `protectedProcedure` + gate; FORBIDDEN with reason `NOT_PARTNER_ACCOUNT | EMAIL_UNVERIFIED | NO_ORGANIZATION | ORGANIZATION_CLOSED | BANNED`), `carrierProcedure` / `shipperProcedure` (org type), `authorizedTenantProcedure(resource, actions)` (checks `oac` role statements), `proProcedure(resource, actions)` (adds `plan.isPro` → `SUBSCRIPTION_REQUIRED`), `onboardingProcedure` (session + partner type, no org required).
- `init.ts`: `createTRPCContext` accepts `app: "admin" | "portal"`; `recordRequestActivity` writes it to a new `activity_log.app` column so portal rows are distinguishable.

### 2.5 `packages/auth` additions
- `org.permissions.ts`: add statements `partner: [read, request, respond, remove]`, `trip: [create, read, update, list]`, `document: [read, upload]`, `report: [read]`, `subscription: [read]`. Grants: owner = all; admin = all except `partner:remove`; member = reads + `trip:create/update`, `order:read/update/list`, `offer:read/list`, `document:upload`.
- `server.ts`: `sendInvitationEmail` links to `NEXT_PUBLIC_PORTAL_URL` (new env, set on both apps) instead of the sending app's `NEXT_PUBLIC_APP_URL`; `emailVerification.sendOnSignUp` stays off (the portal sends it explicitly after `signUpEmail`).
- `email.ts`: `brandedEmail` gains `locale` for its two fixed strings (pt copy).

### 2.6 `packages/edgestore`
`apploadFiles.beforeUpload/beforeDelete`: `ctx.isStaff === "true" || ctx.orgId !== null` (members upload POD/evidence under `[owner: userId, path]`; the tRPC insert remains the real guard). `createEdgeStoreHandler(auth, {resolveStaff?, resolveOrgId?})` gains an optional live `resolveOrgId(userId)`; the portal passes a `member`-table lookup so `orgId` does not depend on the stale session cookie. `kycFiles` unchanged (KYC out of scope).

---

## 3. Database changes (`packages/db`)

Rules honored: text + `as const` vocabularies (never `pgEnum`), additive only (Admin prod keeps running on the newer schema), migration `0014_portal` generated with `db:generate` **and** idempotent dev scripts (`create-portal-tables.mjs`, `add-portal-columns.mjs`), new tables appended to the TRUNCATE list in `scripts/sync-dev-from-logbook.mjs:786`, new schema files exported from `src/schema.ts` and `package.json` exports.

### 3.1 New schema `src/schemas/connections.ts`

```ts
export const CONNECTION_RELATION = ["client-carrier", "subcontract"] as const   // subcontract: requester = contractor
export const CONNECTION_STATUS   = ["pending", "accepted", "declined", "removed"] as const
export const CONNECTION_VIA      = ["response", "registration", "staff"] as const

partner_connection {
  id text pk
  requester_org_id  text FK organization.id (restrict)
  target_org_id     text FK organization.id (restrict)
  relation          text CONNECTION_RELATION
  status            text CONNECTION_STATUS default 'pending'
  accepted_via      text CONNECTION_VIA null
  message           text null
  requested_by_user_id  text FK user (set null)
  responded_by_user_id  text FK user (set null)
  responded_at timestamp null
  created_at, updated_at
  CHECK requester_org_id <> target_org_id
  UNIQUE INDEX (least(requester_org_id, target_org_id), greatest(requester_org_id, target_org_id))  -- one row per pair
  INDEX (target_org_id, status), (requester_org_id, status)
}

export const CLAIM_STATUS = ["pending", "approved", "rejected"] as const
organization_claim {
  id text pk
  organization_id text FK organization (cascade)
  user_id         text FK user (cascade)
  status          text CLAIM_STATUS default 'pending'
  auto_approved   boolean default false
  decided_by      text FK user (set null)
  decided_at      timestamp
  decision_note   text
  created_at
  UNIQUE INDEX (organization_id) WHERE status = 'pending'
  INDEX (user_id)
}
```

The legacy `network` table (`users.ts:134`, no readers/writers) is left untouched; dropping it is a separate decision.

### 3.2 New schema `src/schemas/quotes.ts`

```ts
export const ORDER_REQUEST_STATUS = ["requested", "quoted", "declined", "withdrawn", "closed"] as const
order_request {                      // a client sends an order to specific connected carriers (RFQ)
  id text pk
  order_id        text FK order (cascade)
  carrier_org_id  text FK organization
  status          text ORDER_REQUEST_STATUS default 'requested'
  message         text
  created_by      text FK user (set null)
  responded_at    timestamp
  created_at, updated_at
  UNIQUE (order_id, carrier_org_id)
  INDEX (carrier_org_id, status)
}

export const QUOTE_STATUS = ["sent", "accepted", "declined", "withdrawn", "expired"] as const
quote {                              // a carrier's unsolicited standing quote to a connected client
  id text pk
  carrier_org_id  text FK organization
  client_org_id   text FK organization
  origin          jsonb Location
  destination     jsonb Location
  loading_date    timestamp
  route           route_type_enum (reuses existing pg enum)
  loading_bay     loading_bay_enum null
  capacity_weight numeric(10,3) null, capacity_unit weight_unit_enum null
  fiscal_regime   fiscal_regime_enum
  subtotal, vat, total numeric(14,2); currency currency_enum
  includes_git, includes_gps boolean
  notes text, valid_until timestamp
  status          text QUOTE_STATUS default 'sent'
  order_id        text FK order (set null)     // filled when accepted (order + accepted offer created)
  created_by text FK user (set null); decided_by text FK user (set null); decided_at timestamp
  created_at, updated_at
  INDEX (client_org_id, status), (carrier_org_id, status)
}
```

### 3.3 New schema `src/schemas/trips.ts` (standalone tracking subject)

```ts
export const TRIP_STATUS = ["scheduled", "in-transit", "delivered", "cancelled"] as const
trip {
  id text pk; seq serial unique                 // display ref "TRP-<seq>"
  organization_id     text FK organization      // owner tenant (client or carrier)
  counterparty_org_id text FK organization null // connected partner on the other side, if any
  driver_name text; driver_phone text (E.164)   // phone-only driver: no user/driver row required
  conversation_id text FK chat_conversation (set null)   // thread link, set on first ping/request (one-way import chats → trips avoids a schema cycle)
  truck_plate text null                          // free text, no FK
  cargo_description text null
  origin jsonb Location; destination jsonb Location
  status text TRIP_STATUS default 'scheduled'
  tracking_enabled boolean default true
  started_at, expected_delivery_at, delivered_at timestamp null
  created_by text FK user (set null); created_at, updated_at
  INDEX (organization_id, status), (counterparty_org_id, status)
  INDEX (driver_phone) WHERE status = 'in-transit'
}
trip_location          — same columns as order_location (tracking.ts:66) with trip_id FK trip (restrict), unique chat_message_id, lat/lng CHECK, index (trip_id, recorded_at)
trip_tracking_request  — same columns as tracking_request (chats.ts:75) with trip_id; UNIQUE (trip_id, slot_date, slot, attempt); index (external_id)
trip_route             — same columns as order_route keyed by trip_id (cascade)
```

### 3.4 New schema `src/schemas/notifications.ts`

```ts
export const NOTIFICATION_KIND = [
  "connection.requested", "connection.accepted", "connection.declined", "connection.removed",
  "claim.approved", "claim.rejected", "member.joined",
  "order.requested", "order.quoted", "order.booked", "order.status", "order.cancelled", "order.document",
  "quote.received", "quote.accepted", "quote.declined", "quote.withdrawn",
  "trip.started", "trip.delivered", "trip.no-response",
  "subscription.changed",
] as const
export const EMAIL_STATE = ["none", "pending", "sent", "failed"] as const

notification {
  id text pk
  organization_id text FK organization (cascade)
  user_id         text FK user (cascade)          // fan-out: one row per member
  kind            text NOTIFICATION_KIND
  entity_type text null; entity_id text null      // 'order' + orderId, 'trip' + id, 'connection' + id …
  params          jsonb (scalar values only, same rule as activity_log)
  read_at         timestamp null
  email_state text EMAIL_STATE default 'none'; email_attempts int default 0; email_last_error text
  dedupe_key text null       // 'history:<order_history.id>' when materialized from the trail; 'trip:<id>:<slotDate>:<slot>' for no-response; null for direct writes
  created_at
  INDEX (user_id, created_at desc)
  INDEX (user_id) WHERE read_at IS NULL
  UNIQUE INDEX (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL   // idempotent materialization
  INDEX (email_state) WHERE email_state = 'pending'
}
notification_cursor { organization_id pk FK, last_history_created_at timestamp, updated_at }   // row created at portal activation with now(), never backfilled
```

### 3.5 Column additions (existing tables)

| Table | Column | Why |
|---|---|---|
| `order` | `source text ["admin","client","carrier"] default 'admin' not null` | Admin can tell portal-originated orders apart |
| `organization` | `subscription_expires_at timestamp null` | pro gating (`plan = 'pro' AND (expires IS NULL OR expires > now())`); plan column already exists |
| `organization` | `portal_activated_at timestamp null` | set when the first owner joins; Admin lists "on the portal" |
| `activity_log` | `app text null` | admin vs portal rows |

Dev reset: append `notification, notification_cursor, trip_location, trip_tracking_request, trip_route, trip, order_request, quote, partner_connection, organization_claim` to the TRUNCATE list in `scripts/sync-dev-from-logbook.mjs:786`.

### 3.6 Indexes on existing tables (tenant queries)
`order(shipper_id, expected_loading_date)`, `order(carrier_id, expected_loading_date)`, `order(status)`, `order_offer(carrier_id, status)`, `order_history(created_at)`.

### 3.7 Better Auth additional fields
`organization.subscriptionExpiresAt` and `portalActivatedAt` are **not** registered as plugin additional fields (written by Drizzle only, like `kycStatus`), so both apps' `createOrganization` bodies stay unchanged.

---

## 4. Auth, onboarding and membership

| Flow | Mechanism |
|---|---|
| Sign-up | `/sign-up` → `onboarding.signUp({name, email, password, companyType, invitationId?})` (public) → `auth.api.signUpEmail({body:{…, type}})` where `type` = `companyType`, or the inviting organization's type when `invitationId` is given (looked up server-side) → `auth.api.sendVerificationEmail({body:{email, callbackURL: '/onboarding'}})`. `POST /api/auth/sign-up/email` is blocked in the portal route (as in Admin); `/update-user` is **not** blocked (profile edits; `user.update.before` hook still locks `type`/`status`). |
| Verify email | `/verify-email?email=` is a "check your inbox / resend" page; the link in the email hits Better Auth's `/api/auth/verify-email`, which signs the user in (`autoSignInAfterVerification` already on) and redirects to `/onboarding`. The tenant gate requires `emailVerified`; unverified sessions see the same page. |
| Sign-in / reset | Copies of Admin's views without the `staffEmail()` folding. |
| Onboarding (no membership yet) | `/onboarding`: NUIT lookup → **new**: `onboarding.createOrganization` (direct insert like `organizations.register`, `status pending`, `metadata.registeredVia = 'portal'`) + `auth.api.addMember({body:{userId, organizationId, role:'owner'}})` + `portal_activated_at` + `notification_cursor` row; the client then calls `authClient.organization.setActive({organizationId})` (refreshes the cookie cache) and navigates to the dashboard. **Exists, no members**: `onboarding.claim` → auto-approve when `user.emailVerified && lower(user.email) == lower(organization.email)` (placeholder emails never match) else `organization_claim` pending + email to `OPS_NOTIFICATION_EMAIL` + Admin queue. **Exists, has members**: show "ask your owner to invite you". Claims are only offered to users with no membership (`organizationLimit` 1). |
| Claims (Admin side) | `partners.claims` list + `partners.decideClaim({id, decision, note})` (`organizations:update`, manager+) → approve = `auth.api.addMember(owner)` + `portal_activated_at` + notification `claim.approved` + email; reject = email with note. Tile in the partners review queue. |
| Invite members | Owner/admin: `authClient.organization.inviteMember` (required `name` field) → email → `/accept-invitation/[id]` page: sign-up/sign-in with that exact email → `acceptInvitation` → `setActive` (refreshes the 5-minute cookie cache). Admin gets an "Invite portal owner" action on the partner profile (server-side `createInvitation` with `role: 'owner'`). |
| Subscription (Admin side) | Partner profile: plan select + expiry date (`organizations.update` extended; manager+). Portal `settings/subscription` reads `plan`, `expiresAt`; pro-gated screens render an upgrade card with Appload's contact. |
| Members management | `settings/members` uses the organization plugin's client endpoints directly (`listMembers`, `updateMemberRole`, `removeMember`, `listInvitations`, `cancelInvitation`); no tRPC router needed. |

Gate order (in `(protected)/layout.tsx` and every `tenantProcedure`): session → `type ∈ {shipper, carrier}` else `<AccessDenied/>` (sign-out button, no redirect loop) → `emailVerified` else render the verify page → membership else `redirect('/onboarding')` → `organization.status !== 'closed'`. The `(onboarding)` layout applies the first three checks and redirects members to `/dashboard`.

---

### 4.1 Subscription model v2 (decided 2026-09-10 — supersedes every "free"/"pro" mention in this document)

There is **no free plan**. Plans are named tiers that differ only by how many **tracked movements** (orders that get dispatched, standalone trips that go in transit) an organization may start per calendar month. Nothing else is gated: `proProcedure`, `TenantPlan.isPro` and the `SUBSCRIPTION_REQUIRED` gating of `orders.create`, `orders.sendRequests`, `offers.create`, `quotes.create`, `trips.create` and `analytics.*` are removed. Before staff assign a plan, an organization can onboard, connect partners, manage fleet and drivers, send and answer requests and quotes — only booking, dispatch and trips are blocked with an "activate your plan" prompt. No payments and no plan changes from the portal (a plan is agreed commercially and recorded by staff in Admin).

**Catalog** — `packages/domain/src/subscription.ts` (package export `./subscription`; Drizzle + `@trpc/server` only, no React):

```ts
export { SUBSCRIPTION_PLAN, type SubscriptionPlan } from "@workspace/db/subscriptions";   // ["starter", "business", "enterprise"]
/** Tracked movements per calendar month; null = unlimited. PLACEHOLDER figures until the commercial terms are final — one line each to change. */
export const PLAN_QUOTA: Record<SubscriptionPlan, number | null> = { starter: 10, business: 50, enterprise: null };
export const TRACKING_TIME_ZONE = "Africa/Maputo";
/** "YYYY-MM" of the instant in Africa/Maputo — the month a movement is billed to. */
export function periodKey(at?: Date): string;
/** plan !== null && (expiresAt === null || expiresAt > at) */
export function planIsActive(plan: SubscriptionPlan | null, expiresAt: Date | null, at?: Date): boolean;
export type TrackingAllowance = {
    plan: SubscriptionPlan | null; expiresAt: Date | null; active: boolean;
    period: string;            // periodKey(at)
    used: number;              // subscription_usage rows of this organization in `period`
    quota: number | null;      // PLAN_QUOTA[plan] when active, 0 when not active; null = unlimited
    remaining: number | null;  // max(quota - used, 0); null = unlimited
};
export async function trackingAllowance(db: Db, organizationId: string, at?: Date): Promise<TrackingAllowance>;
/** Throws TRPCError FORBIDDEN "SUBSCRIPTION_REQUIRED" when !active, FORBIDDEN "QUOTA_EXCEEDED" when remaining === 0; returns the allowance otherwise. */
export async function assertTrackingAllowance(db: Db, organizationId: string, at?: Date): Promise<TrackingAllowance>;
/** One usage row per (organization, entity); idempotent (onConflictDoNothing on the unique index); nulls in organizationIds are skipped. */
export async function recordTrackingUsage(db: Db, params: { organizationIds: readonly (string | null)[]; entityType: "order" | "trip"; entityId: string; at?: Date }): Promise<void>;
```

**Schema** — `packages/db/src/schemas/subscriptions.ts` (new; exported from `src/schema.ts` and as `./subscriptions` in `package.json`). The tier vocabulary itself is declared in `src/types/index.ts` with the other vocabularies — `organization` carries the column and `users.ts` imports no table module, so declaring it here would make the two table modules import each other and leave `SUBSCRIPTION_PLAN` in TDZ — and re-exported here, which stays the import path consumers use:

```
export { SUBSCRIPTION_PLAN, type SubscriptionPlan } from "@workspace/db/types"   // ["starter", "business", "enterprise"]
export const USAGE_ENTITY = ["order", "trip"] as const
subscription_usage {
  id text pk default uuid
  organization_id text FK organization (cascade) not null
  period text not null                     -- "YYYY-MM"
  entity_type text USAGE_ENTITY not null
  entity_id text not null                  -- order.id (the pk, NOT order_id) or trip.id
  created_at timestamp default now not null
  UNIQUE INDEX subscription_usage_entity_uq (organization_id, entity_type, entity_id)
  INDEX subscription_usage_period_idx (organization_id, period)
}
```

`organization.subscription_plan` becomes `text("subscription_plan", { enum: SUBSCRIPTION_PLAN })` — **nullable, no default** (null = no plan agreed yet); `subscription_expires_at` unchanged. Migration `0015_subscription` is generated with `pnpm --filter @workspace/db db:generate --name subscription` and the data remap is appended to the SQL by hand:

```sql
UPDATE "organization" SET "subscription_plan" = CASE "subscription_plan" WHEN 'pro' THEN 'business' ELSE NULL END WHERE "subscription_plan" IN ('free', 'pro');
```

Dev script `packages/db/scripts/add-subscription-usage.mjs` (idempotent, same shape and header as `add-portal-columns.mjs`): create the table and indexes if they do not exist, `ALTER COLUMN subscription_plan DROP DEFAULT` and `DROP NOT NULL`, then the same remap. It is run against the shared dev database as part of the build; `subscription_usage` is appended to the TRUNCATE list in `scripts/sync-dev-from-logbook.mjs`. Prod applies 0015 with `db:migrate` (RELEASE.md, M8).

Better Auth (`packages/auth/src/server.ts`): the organization additional field `subscriptionPlan` becomes `{ type: [...SUBSCRIPTION_PLAN], required: false, input: false }` (no `defaultValue`). Neither `organizations.register` (Admin) nor `onboarding.createOrganization` / `partners.register` (portal) writes a plan.

**Counting** — a movement is billed to *both* parties the moment tracking starts:
- Order: inside `applyTransition` (`packages/domain/src/orders/transition.ts`), right after the `order_history` insert, when `input.to === "to-loading"`: `recordTrackingUsage(ctx.db, { organizationIds: [updated.shipperId, updated.carrierId], entityType: "order", entityId: updated.id })`. Every actor, both apps: an Admin dispatch of an order whose parties use the portal counts too, and staff are never blocked. A re-dispatch after an interrupt hits the unique index and costs nothing.
- Trip (M5): `trips.create` with status `in-transit` and `trips.setStatus` → `in-transit` call `assertTrackingAllowance` before the write and `recordTrackingUsage({ organizationIds: [trip.organizationId], entityType: "trip", entityId: trip.id })` after it.

**Gates** (tenant actors only — `actor.kind === "staff"` is never gated):
- Shipper booking: in `applyTransition`, when `ctx.actor.kind === "tenant"` and `input.to === "booked"`, `assertTrackingAllowance(ctx.db, ctx.actor.organizationId)` before any write. The same check in `createOrder` (`packages/domain/src/orders/create.ts`, next to `guardCreateForActor`) when the actor is a tenant and `input.status === "booked"` — the standing-quote acceptance path.
- Carrier dispatch: in `applyTransition`, when `ctx.actor.kind === "tenant"` and `input.to === "to-loading"` **out of `booked`**, the same assertion. Only the first dispatch is gated: a resume out of `stopped`/`issue` lands on `to-loading` again for a movement that was already billed, and a truck on the road must stay movable when the month runs out or the plan lapses under it.
- `orders.transitionOptions`: a `to-loading` target for a carrier on a `booked` order, or a `booked` target for a shipper, whose allowance is not ok is `blocked` with `blockedReason: "SUBSCRIPTION_REQUIRED" | "QUOTA_EXCEEDED"` (evaluated after `INCOMPLETE_FOR_DISPATCH` / `NO_OFFERS`); the response also carries `allowance: TrackingAllowance | null` — null when no gated target is on the table, so a reader with no gated move does not pay for the usage query.
- Error codes `SUBSCRIPTION_REQUIRED` (no active plan) and `QUOTA_EXCEEDED` (this month's allowance used up) exist in the orders and quotes error tables with messages in both languages.

**Tenant gate** — `TenantPlan` becomes `{ plan: SubscriptionPlan | null; expiresAt: Date | null; active: boolean; quota: number | null }` (`quota` = `PLAN_QUOTA[plan]` when active, `0` otherwise; the gate does not count usage — one more query per request is not worth it). `proProcedure` is deleted from `packages/trpc/src/tenant.ts`. `me.session` adds `allowance: TrackingAllowance`.

**Portal UI**:
- Settings › Subscription card: plan name (or "No plan yet"), expiry or "expired on", a usage line with a bar — "12 of 50 tracked movements in September 2026" (unlimited → "Unlimited tracked movements") — "on the portal since", and the contact block. The feature list becomes the tier list from the catalog (name + monthly allowance), marking the current tier.
- Dashboard badge: the plan name, or "No plan" (secondary variant) when null or expired.
- The orders `UpgradeDialog` and the quotes `UpgradeCard` are replaced by one `PlanDialog` (`apps/app/src/components/plan-dialog.tsx`) taking `reason: "SUBSCRIPTION_REQUIRED" | "QUOTA_EXCEEDED"` and the allowance, with the contact CTA and a link to settings. It opens (a) pre-emptively when the shipper clicks Accept on an offer or a standing quote, or the carrier clicks Dispatch, and the allowance is not ok (from `me.session.allowance` / `transitionOptions`), and (b) whenever `offers.accept`, `quotes.accept` or `orders.transition` answers with one of the two codes. New order, send requests, quote on a request, new standing quote and analytics no longer consult any plan: the `isPro` props and the dialogs behind them go away.
- Messages (pt is the source of truth, en mirrors it): remove the `free`/`pro` keys; add plan names (`none`, `starter`, `business`, `enterprise`), the usage/unlimited lines, the dialog copy and the two error messages.

**Admin**:
- `organizations.setSubscription` input `plan: z.enum(SUBSCRIPTION_PLAN).nullable()`; the `subscription.changed` notification carries `{ plan: updated.plan ?? "none" }`.
- Portal section plan editor: select with "No plan" + the three tiers, expiry as today; below it "Tracked this month: 12 of 50" (or unlimited / no plan) read from a new `partners.portalUsage({ organizationId })` query (`organizations: ["read"]`) that returns `trackingAllowance` — ops sees exactly what the portal enforces.
- Admin messages pt/en for the new options, the usage line and the `none` plan in the `subscription.changed` notification copy.

This section is the contract for M4.5 (subscription v2); §2.4, the §4 decisions row and the §5 "Pro-gated" rule are superseded by it.

---

## 5. Portal tRPC API (`apps/app/src/backend/api/routers/_app.ts`)

Every procedure is `tenantProcedure`-based unless marked _public_ / _onboarding_. `T` = tenant org id from ctx.

| Router | Procedures (gate) | Scope rule |
|---|---|---|
| `onboarding` | `signUp` (public), `lookupNuit` (onboarding), `createOrganization`, `claim`, `status` (onboarding) | — |
| `me` | `session` (tenant: user + org + role + plan + counts), `updateCompany` (addresses/contacts; NUIT read-only), `changePassword` (via `authApi.changePassword`) | — |
| `partners` | `search({query, relation})`, `lookupNuit`, `register({relation, …})` (`partner:request`), `request`, `respond` (`partner:respond`), `remove`, `list({relation, status, paging})`, `profile({organizationId})`, `stats` | rows where `requester_org_id = T OR target_org_id = T`; `profile` only when accepted |
| `fleet` (carrier) | `trucks.list/register/update`, `trailers.*`, `links.*`, `vehicleSearch`, `drivers.list/register/update/search`, `assignDriver` (`fleet:*`) | `carrier_id = T` injected; updates use `and(eq(id), eq(carrierId, T))` |
| `orders` | `list({section, …})`, `stats`, `get({orderId})`, `create` (shipper, `order:create`, pro), `sendRequests({orderId, carrierOrgIds})`, `withdrawRequest`, `cancel`, `transition` (carrier chain / shipper cancel), `documents.list/add` (POD/evidence), `history`, `timeline` | shipper: `order.shipper_id = T`; carrier: `order.carrier_id = T` OR an `order_request` for T OR a pending offer by T |
| `offers` | `listForOrder`, `create` (carrier answering a request, `offer:create`, pro), `update`, `withdraw`, `accept` (shipper → booking door), `decline` | offer rows by `carrier_id = T` (carrier) or by `order.shipper_id = T` (shipper); `recorded` never returned |
| `quotes` | `list`, `create` (carrier, pro), `withdraw`, `accept` (client: completes cargo details → `createOrder` booked with the accepted offer), `decline` | `carrier_org_id = T` or `client_org_id = T` |
| `trips` | `list`, `get`, `create` (pro), `update`, `setStatus`, `trail`, `route`, `requestLocation` (Infobip) | `organization_id = T OR counterparty_org_id = T` |
| `map` | `overview`, `orderRoute`, `orderTrail` | orders where `shipper_id = T OR carrier_id = T` (parties only); trips where `organization_id = T OR counterparty_org_id = T` |
| `analytics` | `pipeline`, `monthly`, `money`, `kpis({period})`, `partners({period, sort})` (`report:read`, pro) | tenant predicate + own-leg money only |
| `notifications` | `list({cursor, unreadOnly})`, `unreadCount`, `markRead`, `markAllRead` | `user_id = ctx.userId AND organization_id = T` |
| `search` | `global({query})` for ⌘K (loads, partners, drivers, vehicles) | tenant-scoped unions |

Cross-cutting: `registerActivityCatalog(portalCatalog)` at module scope; all mutations take `expectedVersion` where the row has one; domain errors travel in `TRPCError.message` (existing `domainErrorCode` pattern).

Concrete rules an implementer must not have to guess:
- **Quota-gated** (see §4.1; `proProcedure` no longer exists): the shipper's booking (`offers.accept`, `quotes.accept`), the carrier's dispatch (`orders.transition` to `to-loading`) and starting a trip check the tenant's monthly allowance; every other procedure is available on every plan.
- **Order sections** — shipper: `all` · `requests` (prospects with an open `order_request`) · `quoted` (prospects with ≥ 1 pending offer) · `booked` · `on-going` (`TRACKED_STATUSES`) · `delivered` · `history` (completed/cancelled/underbid). Carrier: `requests` (`order_request.status = requested` for T) · `quoted` (own pending offers) · `booked` · `on-going` · `delivered` · `history` (completed/cancelled + own offers lost/declined).
- **Partner search** (`partners.search`): min 2 characters, `organization.type` = the relation's counterpart (`client-carrier` → opposite type; `subcontract` → carrier), excludes self and `status = closed`, limit 10, returns `{id, name, province (physicalAddress.state), kycStatus, connection: null | status}` — never email/phone/NUIT of unconnected organizations. `lookupNuit` returns the same shape for an exact 9-digit match.
- **Register partner** (`partners.register`): NUIT (9 digits) and phone required, email optional → placeholder `missing-<uuid>@appload.invalid` (Admin's `PLACEHOLDER_PATTERNS` already flags it), addresses optional; `organization.status = pending`, `metadata.registeredBy = T`; connection inserted as `accepted` with `accepted_via = registration`.
- **Drivers** (`fleet.drivers.register`): same recipe as Admin's `fleet.registerDriver` (server-side `signUpEmail`, `type: driver`, random password); email optional → `driver-<e164 digits>@appload.invalid`.
- **Dispatch** (`orders.transition` to `to-loading`): the form picks a registered driver and truck (+ trailer/link) of T; the mutation writes `driverId`, `driverName`, `driverPhoneNumber`, `driverPassport`, `truckPlate`, `truckAge = truckAgeFromYear(truck.year)`, then applies the transition (dispatch readiness re-checked server-side).
- **Booking side effects**: other pending offers → `lost` (existing settle), every `order_request` on the order → `closed`, `quote.order_id` set when the order came from a standing quote.
- **Trip status**: `scheduled → in-transit` (sets `started_at`), `in-transit → delivered` (sets `delivered_at`, `tracking_enabled = false`), any non-terminal → `cancelled`. Only the owner tenant may change status; the counterparty reads.
- **Emails**: Portuguese copy (`DEFAULT_LOCALE`), branded shell; no per-user preferences in v1.

### 5.1 Order & quote lifecycle on the shared model

```
Client direct order:   orders.create (prospect, source 'client', shipper = T)
                       → orders.sendRequests → order_request rows + notify carriers (order.requested)
Carrier answers:       offers.create (pending, commissionTotal 0, priced by priceOffer vs order.route)
                       → order_request.status = quoted + notify client (order.quoted)
Client books:          offers.accept → domain applyTransition(prospect→booked, offerId) (currency lock, KYC gate,
                       acceptOffer copy, version lock, settle other offers → lost, requests → closed,
                       history row, sheet_sync pending) + notify carrier (order.booked)
Carrier executes:      orders.transition — forward chain to-loading…delivered (dispatch readiness needs a
                       registered driver + truck), interrupts stopped/issue + resume, POD/evidence uploads.
                       Never: completed, backward moves, terminal reversals, flag resolution (Admin only).
Client cancels:        prospect/booked only, note required (existing cancel rules), requests withdrawn.
Carrier standing quote: quotes.create → notify client → quotes.accept → client fills cargo form →
                       createOrder(status booked, offers:[{…, accepted:true}]) with source 'carrier'
```

Order Ids: `nextOrderId(dbMaxSeq, 0, year)` with the `(year, seq)` unique-index retry; the logbook is healed by the existing sheet-sync cron. Tracking of booked portal orders is the Admin pipeline (follow-up chat, cron, webhook) — nothing to build.

---

## 6. Trips and tracking

### 6.1 Trip model
A `trip` is any movement a tenant wants watched that is **not** an Appload order (or an order the portal cannot see). Register with driver name + phone (E.164, `z.e164()`), origin/destination via `LocationInput`, optional plate/cargo/dates; "already in transit" = `status: 'in-transit'`, `started_at = now`. The Trips page lists **standalone trips only**: order-backed movements are already on Orders › On the road, and the `/map` overview is where the two kinds are seen together.

### 6.2 Outbound pings (portal cron)
`apps/app/src/app/api/cron/trips-tracking/route.ts` (`authorizeCron` from `@workspace/comms`, `maxDuration 60`), QStash schedule id **`appload-app-tracking`** (never reuse `appload-tracking`), same cron `*/15 8-9,17-18 Africa/Maputo`. Runner in `@workspace/domain/tracking/trip-slot.ts`: select `trip` in-transit with `tracking_enabled`, **skip phones that also have an Admin order in `TRACKED_STATUSES`** (the Admin cron already pings them), ensure a `chat_conversation` (`startConversation`, stored on `trip.conversation_id`), claim `trip_tracking_request` on the unique key, attempt 1 native location request if the WhatsApp session is open else template, attempt 2 template, attempt 3 SMS — identical decision table. Template placeholders: `{{2}}` = `TRP-<seq>`, `{{3}}` plate or "—", `{{4}}/{{5}}` origin/destination state; button payload `share-location:TRP-<seq>`. Copy stays Meta-approved (no wording change). A slot whose three attempts end unanswered writes `trip.no-response` (dedupe key `trip:<id>:<slotDate>:<slot>`).

### 6.3 Inbound pins (Admin webhook, one addition)
In `resolveOrderForConversation` (now `@workspace/domain/tracking/locations.ts`): the existing order attribution runs first and unchanged; only when it yields nothing does the trip branch run — the trip whose `conversation_id` is this conversation, else the newest `in-transit` trip whose `driver_phone` normalizes to the sender → `recordTripLocation` (idempotent on `chat_message_id`). The "responded" flip also updates `trip_tracking_request` rows on that conversation (a phone shared by an order and a trip closes both, which is acceptable), and the delivery-report loop mirrors each report onto `trip_tracking_request` by `external_id` — the shared decision table drops the SMS escalation only when it can see a `delivered` attempt. Inbound messages from trip drivers appear in Admin's Messages inbox like any other thread. Nothing else in Admin changes.

### 6.4 Maps
`trips.route` computes/caches via `@workspace/maps/server` into `trip_route` (same cache-key rule); `trips.trail`/`overview` mirror the Admin queries with the tenant predicate. Portal `/map` shows the tenant's tracked orders + trips with the shared `RouteLayer`/`OverviewPins`; 60 s polling.

---

## 7. Notification center

- **Write model**: `notify(db, batchOrNull, {organizationIds|userIds, kind, entity, params, email?})` in `@workspace/domain/notifications.ts` fans out one row per member (max `membershipLimit` 100). Portal mutations include the rows in the same `db.batch` as the domain write when possible.
- **Admin-originated order events**: `materializeOrderEvents(db, organizationId)` reads `order_history` rows with `created_at > cursor − 60 s` (history rows are inserted after the order write, non-atomically, so a small look-back plus the `dedupe_key` unique index makes this exact) for orders where `shipper_id = org OR carrier_id = org` (kinds `transition`, `offer`, `document`; only rows whose actor is Appload staff — `user.type = 'appload'` — or no actor at all, which is a cron or a webhook: a partner's own move already writes its own notification for the counterparty, so materializing it too would double both the row and its email. A dispute is Appload's bookkeeping on the order and reaches nobody), inserts notifications with `onConflictDoNothing`, then advances the cursor. The birth-certificate row (`from_status` null) is not a status change and notifies nobody unless it lands on `booked`. Called (a) by `notifications.unreadCount` (one indexed query per 30 s poll; concurrent polls are harmless) and (b) by the cron below for every organization with `portal_activated_at` set (guarantee for emails while nobody is online), least recently read first so the batch is a rotating window rather than the same prefix every run.
- **Email outbox**: rows with `email_state = 'pending'` are swept by `apps/app/src/app/api/cron/notifications/route.ts` (QStash `appload-app-notifications`, every 5 minutes, batch 25, max 5 attempts) using `sendEmail`/`brandedEmail` with localized copy (`getTranslations({locale})` from the recipient's stored locale; default pt). A row is claimed (`email_state = 'sending'`, attempt counted) before it is sent, so two overlapping runs cannot send it twice. Kinds that email: `connection.requested/accepted`, `claim.*`, `order.requested/quoted/booked`, `order.cancelled`, `order.status` on delivery only, `quote.received/accepted`, `trip.no-response`, `subscription.changed` — the same set from both writers, whether the event was typed into the portal or into Admin.
- **UI**: bell in the header with `unreadCount` (`refetchInterval 30_000`), popover list (`refetchInterval 10_000` while open), full `/notifications` page with filters, per-row deep link (derived from `entity_type/id` where the row is rendered — as a typed `Link` in the portal, as a path in the email), mark-as-read on click, mark-all. Own mutations invalidate `notifications` immediately.
- **i18n**: `App.notifications.kinds.<kind>` ICU messages with the scalar params (same convention as `ActivityLog.*`).
- **Upgrade path** (documented, not built): tRPC `httpSubscriptionLink` SSE on `notifications.onChange` once the app runs on a plan without the 60 s cap.

---

## 8. Analytics (tenant scope)

- `analytics.pipeline`/`monthly`/`money`: copies of `orders.stats`, `dashboard.monthly`, `orders.cashflow` with the tenant predicate; money lines from the tenant's own leg (shipper: what it pays/paid; carrier: what it invoices/received), no insurance line unless `insurance_subscriber = 'shipper'` for shippers, no commission.
- `analytics.kpis`/`partners`: `@workspace/domain/kpis` `aggregate({tenant, groupBy: 'partner'})` — non-money KPIs (on-time, days, demurrage, incidents, damage, CO₂, backload share) for both sides; USD money only from the tenant's leg at the loading-day rate (`fx_daily_rate`, in-query bounded top-up kept). Period presets and bucketing reuse `kpiPeriod`/`bucketStarts`.
- Views: `MetricTile`, `KpiTile`, `CardBoundary`, `OrdersByMonth`, `PriceChart`, `TransportsChart` copied; charts via `@workspace/ui/components/chart(-primitives)`.

---

## 9. Frontend (`apps/app`)

### 9.1 Scaffold (copied from Admin, adapted)
`package.json` (name `app`, `next dev --port 3001`), `next.config.ts` (`transpilePackages: ["@workspace/ui", "@workspace/maps"]`), `tsconfig.json` (paths for `@/*`, `@workspace/{auth,i18n,db,trpc,ui,domain,comms,maps}/*`), `eslint.config.js`, `postcss.config.mjs`, `components.json`, `i18n-env.d.ts` (typed against `src/messages/pt.json`), `.env.example`, `vercel.json` (Admin's `ignoreCommand`), `src/proxy.ts` + `src/routes.ts` (`DEFAULT_LOGIN_REDIRECT = "/dashboard"`, auth routes + `/onboarding` handling), `src/i18n/{routing,navigation,request}.ts` (`localePrefix: "never"`, `timeZone: "Africa/Maputo"`), `src/backend/api/{client,server}.tsx`, `src/app/api/{auth/[...all],trpc/[trpc],edgestore/[...edgestore],cron/*}`, `src/messages/{en,pt}.json` (`General` same shape as Admin; `App.*` namespaces; `App.list` = copy of `Admin.list`), `public/` logos + `background/loading.svg`, `.claude/launch.json` entry `app` on 3001.

### 9.2 Route tree (`src/app/[locale]/…`, pt slugs in `routing.ts`)

```
(auth)/          sign-in (/iniciar-sessao) · sign-up (/criar-conta) · forgot-password · reset-password
                 verify-email (/verificar-email) · accept-invitation/[id] (/aceitar-convite/[id])
(onboarding)/    onboarding (/registo-empresa)          — session, no membership yet
(protected)/     layout.tsx: session → tenant gate → shell (Sidenav per org type, header bell, ⌘K)
  dashboard/                                            tiles · monthly chart · money card · on-the-road map · latest
  partners/                    (/parceiros)             tabs: clients|carriers|subcontractors|requests · ?id= profile sheet
  fleet/[kind]/                (/frota/[kind])          carrier only: trucks|trailers|links (parallel routes @header/@stats/@data)
  drivers/                     (/motoristas)            carrier only
  orders/[section]/            (/pedidos/[section])     all|requests|quoted|booked|on-going|delivered|history (sections differ per org type)
  orders/details/[orderId]/    (/pedidos/detalhes/[orderId])  static `details` segment beside `[section]`, as in Admin (two sibling dynamic segments are not allowed)
  quotes/                      (/cotacoes)              carrier: sent · client: received
  trips/                       (/viagens)               standalone trips; order-backed movements are on Orders › on-going; ?id= sheet
  trips/[tripId]/              (/viagens/[tripId])      detail with map, pings, ping-now, status
  map/                         (/mapa)
  analytics/                   (/analises)              pro
  notifications/               (/notificacoes)
  settings/                    (/definicoes)            tabs: profile · company · members · subscription
[...rest]/ → not-found
```

### 9.3 Per-feature module layout (Admin convention)
`src/frontend/pages/<feature>/{types,views,sections,columns,hooks,components,server}`; `types/index.ts` owns the URL parser (`xListInput(get)`) shared by the RSC `prefetch` and the client `useSuspenseQuery`; `server/procedures.ts` exports the router; list pages use the copied kit (`src/components/list/*`, `list-fallbacks.tsx`) with `ListPageShell` + parallel slots + per-slot `loading.tsx`; forms use `buildSchema(msg)` → server Base schema + translated client schema; sheets keyed by `?id=`.

### 9.4 Component tree (new components)

```
AppShell
├─ Sidenav (groups by org type)
│   shipper: Dashboard · Orders · Quotes · Trips · Map · Partners · Analytics · Settings
│   carrier: Dashboard · Orders · Quotes · Trips · Map · Fleet · Drivers · Partners · Analytics · Settings
│   badges: orders.attention (60 s) · notifications.unreadCount (30 s)
├─ Header: NotificationBell → NotificationPopover(NotificationItem[]) · CommandPalette (⌘K) · NavUser
└─ Page views
   ├─ Onboarding: CompanyTypeStep · NuitLookupStep · CompanyDetailsForm · ClaimPendingCard · VerifyEmailCard
   ├─ Partners: PartnersHeader (search + Add partner) · PartnersTabs · PartnersTable · PartnerProfileSheet
   │   AddPartnerDialog (search existing → ConnectionRequestForm | RegisterPartnerForm) · RequestsList (accept/decline)
   ├─ Fleet: VehiclesTable · RegisterVehicleDialog (copied) · VehicleProfileSheet · DriversTable · RegisterDriverDialog · DriverProfileSheet
   ├─ Orders: OrdersHeader · OrdersStats · OrdersTable · OrderSheet · NewOrderSheet (CreateOrderForm, tenant variant)
   │   SendRequestsDialog (choose connected carriers) · OfferForm (carrier) · OffersPanel (client: compare & accept)
   │   OrderDetail: SummaryCard · TrackingCard(OrderRouteMap) · TimelineCard(HistoryTimeline) · DocumentsCard(AddDocumentDialog: POD/evidence)
   │   TransitionBar (allowed edges for the actor; note/evidence/POD requirements)
   ├─ Quotes: QuotesTable · NewQuoteSheet (carrier) · QuoteSheet · AcceptQuoteDialog (client cargo form)
   ├─ Trips: TripsHeader · TripsTable · NewTripSheet (phone-first form) · TripSheet · TripDetail(TripRouteMap, PingList, RequestLocationButton, StatusMenu)
   ├─ Map: MapView (OverviewPins over orders+trips) · MapEntityList · SelectedCard
   ├─ Analytics: PipelineTiles · OrdersByMonth · MoneyCard · KpiTiles · PartnersRanking · PriceChart · PeriodSelect
   ├─ Notifications: NotificationsList · KindFilter · MarkAllButton
   └─ Settings: ProfileCard · PasswordCard · CompanyCard (addresses, contacts; NUIT read-only) · MembersTable · InviteMemberDialog · SubscriptionCard
```

### 9.5 Admin additions (small, in `apps/admin`)
- Partners profile sheet: **Portal** section — claims (approve/reject), "Invite portal owner", plan + expiry editor, "on portal since" (`portal_activated_at`).
- Review queue tile: pending claims (`partners.reviewQueue`).
- Orders list: `source` chip + filter (optional, one column).
- Webhook/tracking: the trip attribution branch (§6.3).
- Import rewrites for the extracted packages (mechanical).

---

## 10. Deployment, environment, operations

| Item | Value |
|---|---|
| Dev port | `3001` (already in Better Auth `allowedHosts`/`trustedOrigins`; `turbo dev` runs admin 3000, website 3100, app 3001) |
| Vercel | two projects: `appload-app-dev` (Production Branch `dev`) and `appload-app-prod` (Production Branch `prod/app`); Root Directory `apps/app`; "Include files outside root"; `apps/app/vercel.json` = Admin's `ignoreCommand`; on `prod/app` add the `[ "$VERCEL_GIT_COMMIT_REF" = "prod/app" ]` bootstrap clause (same trick as `prod/admin`) |
| Origins | dev `https://app.dev.appload.co.mz`, prod `https://app.appload.co.mz` (both to confirm — neither project exists before M8; take the real hostname from each project's Domains tab); `BETTER_AUTH_URL` per project |
| Env (apps/app/.env.example) | Final list. `DATABASE_URL` + `BETTER_AUTH_SECRET` byte-for-byte the Admin's (one database, one cookie signature); `BETTER_AUTH_URL` and `NEXT_PUBLIC_PORTAL_URL` = this project's origin (`NEXT_PUBLIC_PORTAL_URL` also on both Admin projects); `NEXT_PUBLIC_APP_URL` = the **Admin's** origin (the claim email links there); `OPS_NOTIFICATION_EMAIL` (claim emails; unset = none, the Admin queue still fills); `NEXT_PUBLIC_CONTACT_EMAIL` (the "talk to Appload" address, falls back to `comercial@apploadafrica.com`); `RESEND_API_KEY`, `EMAIL_FROM`; `NEXT_PUBLIC_GOOGLE_SHEETS_AUTH_MODE=service-account` (read at import by packages/auth although the portal has no Google sign-in); `EDGE_STORE_*` (4), `INFOBIP_*` (6), `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `QSTASH_TOKEN` (operator only — not set on Vercel), `CRON_SECRET`, `GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (portal origins added to the referrer list), `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`, `KYC_ENFORCEMENT` (same value as Admin — it is the same door). Deliberately absent: `COOKIE_DOMAIN` (separate session cookies) and every `GOOGLE_*` OAuth/Sheets credential (the portal never calls Sheets; its orders leave a `pending` `sheet_sync` row the Admin cron drains) |
| turbo.json / ci.yml | Done in M0/M1 and re-audited in M8: `globalEnv` lists every name in both `.env.example` files (`NEXT_PUBLIC_PORTAL_URL`, `OPS_NOTIFICATION_EMAIL`, `NEXT_PUBLIC_CONTACT_EMAIL` included) and the CI env block already carries every placeholder the portal build needs — nothing the portal reads at module scope is new |
| QStash | `node apps/app/scripts/qstash-schedules.mjs --apply` (reads `NEXT_PUBLIC_PORTAL_URL`): `appload-app-tracking` → `/api/cron/trips-tracking`, `CRON_TZ=Africa/Maputo */15 8-9,17-18 * * *`; `appload-app-notifications` → `/api/cron/notifications`, `*/5 * * * *`. 304 deliveries/day, ≈ 370 with the Admin's three — inside the free tier's 500. Re-registering an id repoints it, so one QStash account drives either dev or prod, not both |
| Migrations | `0014_portal` **and** `0015_subscription` applied to prod with `pnpm --filter @workspace/db db:migrate` before the first `prod/app` push *and* before any Admin release carrying this branch (the Admin's Portal tab reads `organization_claim`); `0015` remaps `pro` → `business` and `free` → NULL. Dev DB got both from the idempotent scripts (`create-portal-tables`, `add-portal-columns`, `add-subscription-usage`) — never both against one database |
| Docs | Done (M8): RELEASE.md gains the two `prod/app`/`dev` portal rows and release command, §1 "Partner portal" migrations, §2 "The portal's projects" + "New on the admin projects", §3 step 5 (Maps referrers), §5 (the webhook stays on the Admin), §6 step 3 (schedules), §8 "First partner on the portal"; README gains the workspace rows and the dev ports; this plan is `docs/portal-design.md` |

Branching: `stage/22-portal` from `dev`; one PR per milestone group into `dev` (M0 first, alone).

---

## 11. Phase 2 execution plan (Opus 5 Ultracode)

Each milestone = one Workflow run: implement (parallel agents on disjoint units, `model: "opus"`), then `pnpm turbo lint typecheck build`, then an adversarial review panel (lenses: tenant leakage, schema/DB rules, Better Auth/Next 16/i18n conventions, UX parity with Admin), fix, then browser verification in Chrome.

M0 rules: extraction is a **pure move plus parameterization** — no logic edits, Admin routers become thin adapters that build the actor/sheets context and call the package; `frontend/pages/orders/types` re-exports the moved status groupings so Admin imports stay valid; M0 ships as its own PR into `dev` with the Admin regression list in §12 run before merge; a diff-focused review agent checks that every moved function body is byte-identical apart from the parameterized lines.

| # | Milestone | Parallel units | Depends on | Status |
|---|---|---|---|---|
| M0 | Foundations | (a) `packages/domain` orders extraction + Admin rewire; (b) `kyc`/`kpis`/`tracking` extraction; (c) `packages/comms` + `packages/maps`; (d) `packages/db` schemas + migration + dev scripts; (e) `packages/trpc` tenant gate + `packages/auth` statements/env + edgestore rule | — | Built 2026-09-09 (`a1c078d`) |
| M1 | App scaffold & auth | (a) config/i18n/proxy/layouts/shell; (b) sign-up/verify/sign-in/reset/onboarding/claim; (c) settings (profile, members, subscription) + Admin portal section | M0 | Built 2026-09-10 (`a316b32`, + `093f1a0` stale-cookie fix) |
| M2 | Partners & connections | search/lookup/register/request/respond/list/profile + UI + notifications wiring | M1 | Built 2026-09-10 (`0f327ae`) |
| M3 | Fleet & drivers (carrier) | vehicles; drivers (server-side account creation, optional email → placeholder) | M1 | Built 2026-09-10 (`0f327ae`) |
| M4 | Orders, requests, offers, quotes | (a) list/detail/projections; (b) create + requests + offers + booking door; (c) transitions + documents; (d) quotes | M2, M3 | Built 2026-09-10 (`6d1a88e`) |
| M4.5 | Subscription v2 | catalog + `subscription_usage` + counting/gates in the domain door; portal plan dialog, subscription card and dashboard badge; Admin plan editor + usage line (§4.1) | M1, M4 | Built 2026-09-10 (`87f356e`); quota figures still placeholders |
| M5 | Trips & tracking | (a) trip CRUD + UI; (b) cron + Infobip; (c) Admin webhook attribution; (d) maps | M2 | Built 2026-09-10 (`6357657`) |
| M6 | Notifications center | bell/popover/page, materializer, email outbox cron; wire kinds from M2–M5 | M2–M5 | Built 2026-09-10 (`36106db`) |
| M7 | Analytics | pipeline/monthly/money/kpis/partners + views | M4, M5 | Built 2026-09-10 (`ac761a3`) |
| M8 | Release | Vercel projects, envs, schedules, RELEASE/README, final full review | M1–M7 | In progress: docs and build plumbing done (§10); the two Vercel projects, their env vars, the DNS records and the QStash registration are operator steps that stay open until the release itself |

---

## 12. Verification

**Admin regression after M0** (behavior-preserving extraction): `pnpm turbo lint typecheck build`; in Chrome on dev: create a prospect with two offers → accept one (booked, others lost) → dispatch to-loading (dispatch readiness) → on-route → stopped → resume → delivered with POD → completed blocked by open dispute; offers create/update/decide; map route + trail render; `GET /api/cron/tracking` with `CRON_SECRET` dry run; KPIs page numbers unchanged for one carrier and one shipper (compare before/after screenshots).

**Portal, per milestone** (Chrome, two test tenants — one shipper, one carrier — plus a staff session):
- Gate: staff session → `NOT_PARTNER_ACCOUNT` screen; unverified email → verify card; tenant A cannot fetch tenant B's order/trip/partner by id (403/404), including via ⌘K and direct URLs.
- Onboarding: new NUIT → org + owner + active org; existing NUIT with matching email → auto-claim; mismatched → claim visible in Admin → approve → owner lands on dashboard; invitation accept flow.
- Partners: search excludes self and opposite-type rules; request → target sees pending + notification + email; accept → both list each other; register unknown carrier → immediate accepted connection, org visible in Admin as pending/placeholder.
- Orders: client creates order → sends requests to two carriers → carrier B quotes (commission 0, client total = carrier total ± VAT by route) → client accepts → order booked in Admin with `source = client`, other request closed; carrier dispatch requires registered driver + truck; POD upload → delivered; client cancel rules; version conflicts surface as `VERSION_CONFLICT`.
- Quotes: carrier standing quote → client accepts with cargo form → booked order with accepted offer, quote linked.
- Trips: register in-transit trip by phone → cron dry run claims a `trip_tracking_request`; simulated Infobip location webhook (same secret) attributes a pin to the trip; map shows trail.
- Notifications: badge count and popover update within one poll after each event above; Admin transition on a portal order appears within ≤ 30 s while the tenant is online and is emailed by the 5-minute sweep when offline (check `email_state`).
- Analytics: tenant numbers equal Admin KPIs for the same party/period restricted to that party's leg; no commission or other-leg column anywhere in network responses (inspect tRPC payloads).
- Build: `pnpm turbo lint typecheck build` green; CI green on the PR.

---

## 13. Explicitly out of scope (v1) / follow-ups
- Google sign-in for partners (needs an auth factory or provider-conditional `mapProfileToUser`).
- KYC self-upload and a tenant file proxy; EdgeStore protected files.
- Online payments; plan changes from the portal.
- SSE/WebSocket notifications; per-tenant WhatsApp sender or template language.
- Drivers as portal members (`driver` org role stays unregistered); phone OTP (`phoneNumber` plugin stubs).
- Dropping the legacy `network` table; the pre-existing Admin bug where `account-card.tsx` calls the blocked `/update-user`; the stale env path in `add-underbid-status.mjs`.

### Left open by M0–M7 (recorded 2026-09-10)

Things the build decided to live with rather than solve. Each is a
deliberate gap, not a bug report — but each is the next question someone
will ask.

- **A manual location request is not a tracked attempt.** `trips.requestLocation` (`apps/app/src/frontend/pages/trips/server/procedures.ts`) sends the ping and stores the outbound `chat_message`, but writes no `trip_tracking_request` row — only the cron's slots claim one. So an ad-hoc "where are you?" is invisible to the delivery-report mirroring (which matches reports by `external_id` on that table) and to any count of attempts. Making it tracked needs a dedupe key that is not a slot.
- **Plate and VIN uniqueness is per carrier, not global.** Two carriers can register the same plate and nothing reconciles them. Global uniqueness first needs an answer for the truck that legitimately changes owner.
- **The Admin still has the stale-cookie redirect loop the portal fixed.** `apps/admin/src/proxy.ts:66` redirects an auth route away on the *presence* of a session cookie; a revoked or expired cookie therefore bounces `/sign-in` → `/dashboard` → `/sign-in`. The portal's fix (`093f1a0`: validate the real session on the auth pages, stop redirecting auth routes in the proxy) transplants directly.
- **A losing bidder keeps seeing the movement.** A carrier that quoted an order and lost still reads that order, so it sees the winner's trip progress (status and dates). Money and other carriers' offers are never exposed — the projection strips them — but the shipment itself is not hidden once the offer is rejected.
- **No mid-trip driver swap.** The driver on a trip (or a dispatched order) is fixed once it starts; changing driver means cancelling and re-registering. The tracking thread is keyed on the phone, so a real swap also has to hand the conversation over.
- **Four cargo fields are patched in after the insert.** The shared create schema in `packages/domain` does not carry `packing`, `expectedTrucks`, `hazchem` or `refrigerated`, so the portal writes them in a second, deliberately non-fatal update right after the order row (`apps/app/src/frontend/pages/orders/server/procedures.ts`). Moving them onto the create payload makes a create one statement that cannot half-land.
- **⌘K is built.** `search.global` (`apps/app/src/frontend/pages/search/server/procedures.ts`) answers loads, partners, drivers and vehicles from `ctx.tenant`, and `CommandPalette` is mounted inside `CommandPaletteProvider` in the protected layout.
- **Two notification kinds have no writer.** `claim.rejected` and `member.joined` are in the vocabulary (`packages/db/src/schemas/notifications.ts`) with pt/en copy, but nothing emits them: a rejected claim is only an email, and someone joining a company raises nothing. Either wire them or drop them from the vocabulary — a kind with copy and no writer reads as a bug to the next person.
