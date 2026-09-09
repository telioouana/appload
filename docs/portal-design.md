# Appload Partner Portal (`apps/app`) — Technical Plan

_Phase 1 deliverable (Fable 5.1). Phase 2 (implementation, Opus 5 Ultracode) starts only after approval._
_Grounded in the codebase as of 2026-09-09 (branch `dev`, last commit `faf2caa`) and ten subsystem reads under `apps/admin`, `packages/*`, `RELEASE.md`._

---

## Context

Appload's operations run in `apps/admin`, a staff-only Next.js 16 app (tRPC v11, Better Auth 1.6, Drizzle on Neon, next-intl pt/en, EdgeStore, Infobip WhatsApp/SMS, QStash cron, Google Maps). Shippers ("Clients") and carriers ("Transporters") exist only as rows in `organization` with no login. The goal is a **multi-tenant, subscription-based portal in the empty `apps/app` directory** where those companies manage partner connections, fleet, direct orders and quotes, trip tracking (including trips already in transit registered by driver phone only), analytics, and an in-app notification center — on the **same database**, so Appload ops keep full visibility in Admin.

Decisions confirmed with Claire (2026-09-09):

| Topic | Decision |
|---|---|
| Commission on portal deals | **None.** Portal offers are priced with `commissionTotal = 0`; client price = carrier price with the existing VAT rules. Staff can still re-price in Admin. |
| Onboarding | **Self-serve + staff approval.** Unknown NUIT → organization created at sign-up. Known NUIT with no members → claim approved by staff in Admin; auto-approved when the verified sign-up email equals the organization's email on file. |
| Subscription | **Manual plans + gating.** Staff set `free`/`pro` and an expiry in Admin; the portal gates pro features and shows a contact prompt. No payments. |
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
   │  authorizedProcedure       │  tenantProcedure / proProcedure
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
| `trips` | `list`, `get`, `create` (pro), `update`, `setStatus`, `trail`, `route`, `requestLocation` (Infobip), `overview` (map) | `organization_id = T OR counterparty_org_id = T`; order-backed trips come from `orders` (union DTO in the view) |
| `analytics` | `pipeline`, `monthly`, `money`, `kpis({period})`, `partners({period, sort})` (`report:read`, pro) | tenant predicate + own-leg money only |
| `notifications` | `list({cursor, unreadOnly})`, `unreadCount`, `markRead`, `markAllRead` | `user_id = ctx.userId AND organization_id = T` |
| `search` | `global({query})` for ⌘K (partners, orders, trips) | tenant-scoped unions |

Cross-cutting: `registerActivityCatalog(portalCatalog)` at module scope; all mutations take `expectedVersion` where the row has one; domain errors travel in `TRPCError.message` (existing `domainErrorCode` pattern).

Concrete rules an implementer must not have to guess:
- **Pro-gated** (`proProcedure`): `orders.create`, `orders.sendRequests`, `offers.create`, `quotes.create`, `trips.create`, `analytics.*`. Everything else is free.
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
A `trip` is any movement a tenant wants watched that is **not** an Appload order (or an order the portal cannot see). Register with driver name + phone (E.164, `z.e164()`), origin/destination via `LocationInput`, optional plate/cargo/dates; "already in transit" = `status: 'in-transit'`, `started_at = now`. The Trips page shows a union: order-backed rows (from `order` in `TRACKED_STATUSES` visible to T) and standalone rows.

### 6.2 Outbound pings (portal cron)
`apps/app/src/app/api/cron/trips-tracking/route.ts` (`authorizeCron` from `@workspace/comms`, `maxDuration 60`), QStash schedule id **`appload-app-tracking`** (never reuse `appload-tracking`), same cron `*/15 8-9,17-18 Africa/Maputo`. Runner in `@workspace/domain/tracking/trip-slot.ts`: select `trip` in-transit with `tracking_enabled`, **skip phones that also have an Admin order in `TRACKED_STATUSES`** (the Admin cron already pings them), ensure a `chat_conversation` (`startConversation`, stored on `trip.conversation_id`), claim `trip_tracking_request` on the unique key, attempt 1 native location request if the WhatsApp session is open else template, attempt 2 template, attempt 3 SMS — identical decision table. Template placeholders: `{{2}}` = `TRP-<seq>`, `{{3}}` plate or "—", `{{4}}/{{5}}` origin/destination state; button payload `share-location:TRP-<seq>`. Copy stays Meta-approved (no wording change). A slot whose three attempts end unanswered writes `trip.no-response` (dedupe key `trip:<id>:<slotDate>:<slot>`).

### 6.3 Inbound pins (Admin webhook, one addition)
In `resolveOrderForConversation` (now `@workspace/domain/tracking/locations.ts`): the existing order attribution runs first and unchanged; only when it yields nothing does the trip branch run — the trip whose `conversation_id` is this conversation, else the newest `in-transit` trip whose `driver_phone` normalizes to the sender → `recordTripLocation` (idempotent on `chat_message_id`). The "responded" flip also updates `trip_tracking_request` rows on that conversation (a phone shared by an order and a trip closes both, which is acceptable). Inbound messages from trip drivers appear in Admin's Messages inbox like any other thread. Nothing else in Admin changes.

### 6.4 Maps
`trips.route` computes/caches via `@workspace/maps/server` into `trip_route` (same cache-key rule); `trips.trail`/`overview` mirror the Admin queries with the tenant predicate. Portal `/map` shows the tenant's tracked orders + trips with the shared `RouteLayer`/`OverviewPins`; 60 s polling.

---

## 7. Notification center

- **Write model**: `notify(db, batchOrNull, {organizationIds|userIds, kind, entity, params, email?})` in `@workspace/domain/notifications.ts` fans out one row per member (max `membershipLimit` 100). Portal mutations include the rows in the same `db.batch` as the domain write when possible.
- **Admin-originated order events**: `materializeOrderEvents(db, organizationId)` reads `order_history` rows with `created_at > cursor − 60 s` (history rows are inserted after the order write, non-atomically, so a small look-back plus the `dedupe_key` unique index makes this exact) for orders where `shipper_id = org OR carrier_id = org` (kinds `transition`, `offer`, `document`, `dispute`; rows whose actor is a member of the org itself are skipped), inserts notifications with `onConflictDoNothing`, then advances the cursor. Called (a) by `notifications.unreadCount` (one indexed query per 30 s poll; concurrent polls are harmless) and (b) by the cron below for every organization with `portal_activated_at` set (guarantee for emails while nobody is online).
- **Email outbox**: rows with `email_state = 'pending'` are swept by `apps/app/src/app/api/cron/notifications/route.ts` (QStash `appload-app-notifications`, every 5 minutes, batch 25, max 5 attempts) using `sendEmail`/`brandedEmail` with localized copy (`getTranslations({locale})` from the recipient's stored locale; default pt). Kinds that email: `connection.requested/accepted`, `claim.*`, `order.requested/quoted/booked`, `quote.received/accepted`, `trip.no-response`, `subscription.changed`.
- **UI**: bell in the header with `unreadCount` (`refetchInterval 30_000`), popover list (`refetchInterval 10_000` while open), full `/notifications` page with filters, per-row deep link (`href` derived from `entity_type/id`), mark-as-read on click, mark-all. Own mutations invalidate `notifications` immediately.
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
  trips/                       (/viagens)               union list; ?id= sheet
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
   ├─ Analytics: PipelineTiles · OrdersByMonth · MoneyCard · KpiTiles · PartnersRanking · PriceChart · PeriodSelect · UpgradeCard
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
| Origins | dev `https://app.dev.appload.co.mz`, prod `https://app.appload.co.mz` (to confirm); `BETTER_AUTH_URL` per project |
| Env (apps/app/.env.example) | `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` (same as Admin), `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_PORTAL_URL` (new; also set on Admin), `RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_GOOGLE_SHEETS_AUTH_MODE=service-account` (read at import by packages/auth), `EDGE_STORE_*` (4), `INFOBIP_*` (6), `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `QSTASH_TOKEN` (operator), `CRON_SECRET`, `GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (portal origin added to the referrer list), `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`, `KYC_ENFORCEMENT`, `OPS_NOTIFICATION_EMAIL` (new; claim emails) |
| turbo.json / ci.yml | add `NEXT_PUBLIC_PORTAL_URL`, `OPS_NOTIFICATION_EMAIL` to `globalEnv` and CI placeholders |
| QStash | `apps/app/scripts/qstash-schedules.mjs` with ids `appload-app-tracking` (tracking windows), `appload-app-notifications` (`*/5 * * * *`) — ≈ 300 msgs/day, inside the free tier with the Admin schedules |
| Migrations | `0014_portal` applied to prod **before** the first `prod/app` push and before any Admin release that includes the Admin-side changes; dev DB via the new scripts |
| Docs | RELEASE.md: `prod/app` row, env table, schedules, first-partner checklist; README workspace table; this plan copied to `docs/portal-design.md` |

Branching: `stage/22-portal` from `dev`; one PR per milestone group into `dev` (M0 first, alone).

---

## 11. Phase 2 execution plan (Opus 5 Ultracode)

Each milestone = one Workflow run: implement (parallel agents on disjoint units, `model: "opus"`), then `pnpm turbo lint typecheck build`, then an adversarial review panel (lenses: tenant leakage, schema/DB rules, Better Auth/Next 16/i18n conventions, UX parity with Admin), fix, then browser verification in Chrome.

M0 rules: extraction is a **pure move plus parameterization** — no logic edits, Admin routers become thin adapters that build the actor/sheets context and call the package; `frontend/pages/orders/types` re-exports the moved status groupings so Admin imports stay valid; M0 ships as its own PR into `dev` with the Admin regression list in §12 run before merge; a diff-focused review agent checks that every moved function body is byte-identical apart from the parameterized lines.

| # | Milestone | Parallel units | Depends on |
|---|---|---|---|
| M0 | Foundations | (a) `packages/domain` orders extraction + Admin rewire; (b) `kyc`/`kpis`/`tracking` extraction; (c) `packages/comms` + `packages/maps`; (d) `packages/db` schemas + migration + dev scripts; (e) `packages/trpc` tenant gate + `packages/auth` statements/env + edgestore rule | — |
| M1 | App scaffold & auth | (a) config/i18n/proxy/layouts/shell; (b) sign-up/verify/sign-in/reset/onboarding/claim; (c) settings (profile, members, subscription) + Admin portal section | M0 |
| M2 | Partners & connections | search/lookup/register/request/respond/list/profile + UI + notifications wiring | M1 |
| M3 | Fleet & drivers (carrier) | vehicles; drivers (server-side account creation, optional email → placeholder) | M1 |
| M4 | Orders, requests, offers, quotes | (a) list/detail/projections; (b) create + requests + offers + booking door; (c) transitions + documents; (d) quotes | M2, M3 |
| M5 | Trips & tracking | (a) trip CRUD + UI; (b) cron + Infobip; (c) Admin webhook attribution; (d) maps | M2 |
| M6 | Notifications center | bell/popover/page, materializer, email outbox cron; wire kinds from M2–M5 | M2–M5 |
| M7 | Analytics | pipeline/monthly/money/kpis/partners + views | M4, M5 |
| M8 | Release | Vercel projects, envs, schedules, RELEASE/README, final full review | M1–M7 |

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
