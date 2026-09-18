# Appload as a partner, per-company references, admin sign-in tightening

_Plan by Fable 5.1 (2026-09-16) for implementation by Opus 5 Ultracode. Follows the dispatch/loading-check/chat work on `stage/24-dispatch-check-chat` (see docs/dispatch-check-chat-design.md). New branch `stage/25-appload-partner` off it._

## Context

The portal today has two disjoint shapes of load: `movement` rows (a company's own loads, tabs "My trucks" / "Partners") and Appload brokerage `order` rows under a separate "Appload" rail group (re-enabled last milestone). They share no key, Appload has no organization row, and movement references are derived from one global sequence (`TRP-41` / `ORD-41`). Claire wants one model: Appload is a partner like any transporter, Appload orders live in the same Orders lists, and every company numbers its own loads.

Claire's decisions:

| Topic | Decision |
|---|---|
| Rail | No "Appload" group. For a transporter, an Appload order booked to them is under Orders › **My trucks**; a load handed to Appload is under Orders › **Partners** with partner "Appload"; for a shipper Appload is one more partner. |
| Handing a load to Appload | The company keeps its **own load row** (its reference), linked to a new Appload `order` (APPL ref, Appload's); the load shows Appload's progress, tracking and chat read-through. |
| Transporter booked by Appload | Gets its **own ORD number on booking**; the APPL ref is shown as the client reference. |
| References | Per company, per year: `ORD-0001-26` (4-digit counter, 2-digit year), also for own-fleet trips (TRP disappears). Loads needing offers are `REQ-0001-26` while collecting offers; on booking they take the next ORD and the REQ stays as history. Own-fleet trips and direct partner orders are ORD from the start. |
| Admin login | Already a username field folding `@apploadafrica.com`. Only tighten: reject `@`/whitespace in the username; fix the copy. |
| KYC uploads | Companies upload their own KYC documents in the portal: company papers, drivers and fleet. Appload only verifies and validates them, and may still upload on a company's behalf. The **signed contract is the one document only Appload uploads** (today the portal uploads it from Settings; that reverses). |

Defaults taken in this plan (one line each to flip; §8 lists what Claire may still change): D1 Appload is a seeded `organization` row with fixed id `appload` and a new org type `"appload"` (no members, `portalActivatedAt` set). D2 one linked movement row per portal-active party per Appload order: the orderer's row (`partner`, `carrierOrgId = appload`) and the executor's row (`own-fleet`, `clientOrgId = appload`). D3 executor rows are created **at request time** as candidates (`offered`, no ORD yet); booking assigns the ORD and cancels the other candidates. D4 status mirror is one-way order → linked rows, from the order doors; `booked → booked`; `completed` leaves the row `delivered` (the tenant closes its own books); cancel while prospect hands the orderer's row back (`declined`, unlinked), later → `cancelled`. D5 linked rows are created only for organizations with `portalActivatedAt`. D6 "side of an order" becomes per row (`shipperId === me` / `carrierId === me`) since a transporter handing a load to Appload is that order's shipper. D7 `/appload/details/[orderId]` stays as a redirect to the tenant's linked load (existing notifications keep working). D8 the quotes page moves to `/quotes` under My company.

Constraint from the code: `packages/domain/eslint.config.js` forbids `movements/**` from importing the order doors, so the linking logic lives in a new `packages/domain/src/appload/` folder that may import both sides.

---

## 1. Schema (migration `0022_appload_partner`, dev scripts)

- `packages/db/src/types/index.ts`: `PARTNER_ORG_TYPE = ["shipper","carrier"]`, `ORGANIZATION_TYPE = [...PARTNER_ORG_TYPE, "appload"]`, `isPartnerOrgType()`, `APPLOAD_ORG_ID = "appload"`, `APPLOAD_ORG_NAME`, `isApploadOrg()`, `REFERENCE_KIND = ["REQ","ORD"]`.
- `packages/db/src/schemas/users.ts:118` `organization.type` enum → `ORGANIZATION_TYPE` (text column, no DDL). Better Auth `additionalFields.type` stays shipper|carrier.
- `packages/db/src/schemas/movements.ts` `movement` += `orderId` (FK `order.id`, set null), `reference`, `requestReference`; indexes `movement_order_idx (order_id)`, partial unique `movement_order_org_uidx (order_id, organization_id) where order_id is not null and status <> 'cancelled'`, partial unique `movement_reference_uidx (organization_id, reference) where reference is not null`. New table `organization_counter (organization_id FK cascade, kind REFERENCE_KIND, year int, last int default 0; PK (organization_id, kind, year))`. Update the header comments (`seq` stays for ordering only).
- `pnpm --filter @workspace/db db:generate` → 0022 (create table, 3 add column, FK, 3 indexes; no ALTER TYPE).
- Dev scripts in `packages/db/scripts/` (dry-run default, `--yes`, DATABASE_URL from apps/admin/.env): `add-appload-partner-columns.mjs` (idempotent DDL), `seed-appload-organization.mjs` (`insert … on conflict (id) do update`, flags `--nuit/--email/--phone` with dev defaults, `type appload`, `status active`, `kyc_status verified`, `portal_activated_at now()`, never a member), `renumber-movement-references.mjs` (per org by `created_at, seq`: own-fleet → ORD; partner at scheduled/booked/in-progress/delivered/closed → ORD; other partner → REQ; year from created_at in Africa/Maputo; only where null unless `--force`; sets `organization_counter.last`; rewrites executor `client_reference` matching `^ORD-\d+$` to the parent's new reference). `sync-dev-from-logbook.mjs` TRUNCATE list += `organization_counter`, and its epilogue re-runs the Appload seed (it truncates `organization`). `RELEASE.md`: seed step with prod NUIT/email/phone, apply 0022, run the renumber once before the portal deploy.

---

## 2. Domain

### 2.1 References
- `packages/domain/src/movements/refs.ts` (pure): `formatReference(kind, n, year)` → `ORD-0001-26`; `movementRef(row)` = `reference ?? requestReference ?? clientReference ?? "—"`; `needsOrderReference(status)` (scheduled, booked, in-progress, delivered, closed). The old `movementRef(seq, execution)` is deleted.
- `packages/domain/src/movements/counters.ts` (server-only): `referenceYear(at)` via `periodKey` (Africa/Maputo); `nextReference(db, organizationId, kind, at)` as ONE statement `insert … on conflict (organization_id, kind, year) do update set last = organization_counter.last + 1 returning last`; `ensureOrderReference(db, row)` (`update … set reference = $ref where id = $id and reference is null`).
- Assignment: `movements.create` own-fleet → ORD; partner → REQ (+ ORD when created straight at a committed status); `transitionMovement` → `ensureOrderReference` when `needsOrderReference(to)`; `respondToOffer` mints the owner's ORD (if null) and the executor's ORD before the CTE, which writes `reference` and `client_reference = owner reference`; `convertMovement` to own-fleet → ensure ORD; `propagateUp` defensive ensure.

### 2.2 Mirror map `packages/domain/src/movements/mirror.ts` (pure)
`mirrorStatus(orderStatus, role: "orderer"|"executor", current)` → `{ status, unlink } | null`: prospect → offered (candidate that already quoted stays prospect); booked → booked; at-loading … offloading → same; delivered → delivered; completed → null; cancelled/underbid → orderer at offered/prospect/declined → `{declined, unlink: true}`, else `cancelled`; executor → `cancelled`. `FOLLOWS_APPLOAD_ORDER` error code. `status.ts` `MovementShape.apploadLinked` → `ownerTargets` = `[]` except `delivered → ["closed"]`; `policy.ts editableGroups(apploadLinked)` → executor row `["paperwork"]`, orderer's row `["paperwork","client","sellAmounts"]`.

### 2.3 Link door `packages/domain/src/appload/link.ts` (server-only; package export `./appload/*`)
- `offerToAppload(db, actor, { id, expectedVersion, message? })`: `loadOwn`; require `partner`, `carrierOrgId === appload`, `orderId null`, status procurement|declined; require loading date, category, cargo description, weight else `APPLOAD_NEEDS_DETAILS` (cause lists the fields); `assertTrackingAllowance`; `createOrder` (packages/domain/src/orders/create.ts) with `nextOrderId: portalNextOrderId(db)` (extract the duplicated `max(order.seq) where year` callback from the portal orders and quotes routers into `orders/next-order-id.ts`), payload from the movement (shipper = tenant, status prospect, route/cargo/dates, description, weight, currency), then `source = client|carrier` by org type; CAS update of the movement (`offered`, `offeredAt`, `orderId`); event `offer/offered` with the APPL id; no notify (Appload has no members).
- `syncApploadLinks(db, { order, from, dispatch?, candidates?: "settle" })`, idempotent, best-effort at every call site: (1) orderer's row for `shipperId` if on portal: insert (`partner`, `carrierOrgId appload`, copied route/cargo/dates, buy leg = shipper price, `requestReference` = REQ, status per map, `trackingEnabled false`, `orderId`) or update (map, stamps via exported `statusStamps`, `ensureOrderReference` on booked+, unlink when told, buy leg re-copied on booked and on admin update); system event with `orderId`/`orderStatus`. (2) executor for `carrierId` on booked+ if on portal: upsert keyed `(order_id, organization_id)` — insert (`own-fleet`, `clientOrgId appload`, `clientName "Appload"`, `clientReference = APPL`, sell leg = carrier price, ORD via `nextReference`, `trackingEnabled false`) or promote the candidate (status, ORD if null, sell leg); with `candidates: "settle"` cancel the other live rows of the order that have `client_org_id = appload` (event `APPLOAD_BOOKED_ELSEWHERE`); on un-book cancel the executor row; on cancelled/underbid cancel all. (3) `dispatch`: copy driver name/phone/id and plates onto the executor row (ids from the open `order_dispatch` pack). Never records usage, never notifies, never announces.
- Candidates: `upsertApploadCandidates(db, { orderPk, carrierOrgIds })` (offered, portal orgs only), `markApploadCandidateQuoted` (→ prospect), `withdrawApploadCandidate` (→ cancelled), `closeApploadCandidates` (all live → cancelled), `linkedMovementId(db, { orderId (APPL or pk), organizationId })`.

### 2.4 Hook points
- `packages/domain/src/orders/transition.ts` (one agent only): after the history row and `recordTrackingUsage`, `await syncApploadLinks(...).catch(log)` with `from = current.status`, `dispatch = isDispatchMove(...)`, `candidates: "settle"` on booking.
- `orders/create.ts`: after the birth history row, `syncApploadLinks({ order: saved, from: null, candidates: acceptedOffer ? "settle" : undefined })` best-effort (covers quotes → booked and admin creates for portal clients). `guardCreateForActor`: owns = `shipperId === org || every offer carrier === org`.
- `orders/policy.ts allowedForActor`: shipper branch by `order.shipperId === actor.organizationId`, carrier branch by `carrierId`.
- Admin `order/server/procedures.ts`: after the deal-form booking write and after `update` (beside `recordDispatch`) → `syncApploadLinks` best-effort.
- Portal `orders/server/requests.ts`: `writeOrderRequests` → `upsertApploadCandidates`; `closeOrderRequests` → `closeApploadCandidates`; `withdrawRequest` → `withdrawApploadCandidate`; `offers.ts create` → `markApploadCandidateQuoted`; the admin offer-create-on-behalf (grep `insert(orderOffer)` in apps/admin) → same.
- Movement doors refuse on `row.orderId !== null`: `transitionMovement` (except `delivered → closed`), `offerMovement/withdrawOffer/respondToOffer/convertMovement`, `movements.update` via `editableGroups(apploadLinked)`, `requestLocation` → `NOT_TRACKABLE`; disputes/costs/payments/own documents stay open.
- Tracking/billing skip linked rows: `tracking/movement-slot.ts`, `tracking/movements.ts` (pin attribution), `projection.ts silentToday` add `isNull(movement.orderId)` (the order side pings and bills).
- Appload org in the domain: `movements/link.ts` `assertExecutor` returns early for Appload, `isConnected` true when either side is Appload, `isOnPortal(appload)` true; `packages/trpc/src/tenant-gate.ts` denies membership of a non-partner org type (`NOT_PARTNER_ACCOUNT`) and narrows `orgType`.

---

## 3. Routers

### 3.1 Portal movements (`apps/app/src/frontend/pages/movements/server/{procedures,projection}.ts`)
`formOptions` pins `{ id: appload, name: "Appload", type: "appload", onPortal: true }` first (`LoadFormOptions.partners[].type` widened); `create` refuses Appload as `clientOrgId` and assigns references; `offer` routes to `offerToAppload` when the carrier is Appload; `withdraw` on a linked row → `FOLLOWS_APPLOAD_ORDER`; `sectionPredicate("trips","procurement")` and `received()` include candidate rows (`organizationId = me`, `orderId not null`, own-fleet, offered|prospect); `toMovementRow.ref = movementRef(row)` + `apploadOrderId`; `toMovementDetail.appload = { orderId, role: orderer|executor|candidate } | null`, permissions computed with `apploadLinked` (`canConvert/canRequestLocation/canReadThread` false); search (`searchWhere` and `search/server/procedures.ts`) replaces the digits→seq rule with `ilike` on `reference`/`requestReference`; every `movementRef` call site passes the row (§5).

### 3.2 Portal rail counts (`settings/server/procedures.ts`)
`RailCounts` → `{ received (now includes candidates), declined, offersToReview, toDispatch, disputes, partners }`; drop `appload.newRequests`; `me.session.organization.type` from `ctx.tenant.orgType`.

### 3.3 Portal orders side-of-order (`orders/server/{projection,procedures,offers}.ts`)
`visibleOrders` carrier branch adds `shipperId = me`; `ownsOrder` either side; `sideOf(row, tenant)`; `assertShipperOf` replaces `assertOrgType("shipper")` in sendRequests/withdrawRequest/cancel/recordLoadingCheck/offers accept+decline; `get` derives `carrier` from `sideOf` (counterparty, money, dispatch, permissions); `transitionOptions`/`loadingCheck.canCheck` by side; `get` returns `linkedLoadId`. `orders.list/stats` stay only while analytics/dashboard read them.

### 3.4 Admin
Two `syncApploadLinks` hooks (§2.4). Partner/organization lists already filter by `type ∈ {shipper, carrier}`, so the Appload row never appears; add `ne(organization.id, appload)` to any unfiltered org search found by grep. Sign-in: §7.

---

## 4. UI

- **Rail** `apps/app/src/frontend/components/navigation/sidenav.tsx`: delete `SHOW_APPLOAD`, `APPLOAD_ICONS`, the group and its imports; Procurement badge = received + declined + offersToReview; Booked badge = toDispatch; add a Quotes leaf under My company (`/quotes`).
- **Routes**: `appload/details/[orderId]/page.tsx` → server redirect to the tenant's linked load via `linkedMovementId` (else notFound); `appload/[section]` → redirects into `/orders/[section]?tab=…` (requests|quoted → procurement; booked; on-going → in-progress; delivered; history); `appload/page.tsx` → `/orders`; move `appload/quotes/*` to `(protected)/quotes/*` with a redirect left behind; `i18n/routing.ts` keeps the `/appload/*` entries (typed redirect targets) and adds `/quotes` (pt `/cotacoes`). Delete the retired Appload list UI (`orders/views/*-view.tsx` list/header/stats, `components/{section-tabs,attention-links}`, `columns/*`, `sections/{new-order-form,new-order-sheet}` + hooks, list parsing in `orders/types`) once nothing imports them.
- **Load page delegation** `movements/views/movement-detail-view.tsx` when `load.appload`: header shows `load.ref` and an "Appload · APPL021.26" badge; `LoadActions` hides transitions/offer/convert and offers "Cancel with Appload" (orderer, prospect/booked → `orders.cancel`); left column `RouteCard` (read-only), `PartiesCard` (partner "Appload"), new `movements/sections/appload-panels.tsx` `ApploadOrderPanels({ orderId, side })` owning the `orders.get/history/transitionOptions/loadingCheck` queries and rendering the existing components from `orders/**`: `OffersPanel` + `RequestsPanel` (orderer while prospect), `TransitionBar` + dispatch `TransitionDialog` (executor), `OperationsCard`, `LoadingCheckCard`, order `DocumentsCard`; then the company's own `MoneyCard`, `CostsCard`, own `DocumentsCard`. Right column: order `TrackingCard`, `ChatCard subjectType="order"`, order `TimelineCard`, then the movement timeline. Candidate rows: header ref = APPL id, `RouteCard` + `OffersPanel` (quote form) only. Errors `followsApploadOrder`, `apploadNeedsDetails`; offer dialog copy "Send to Appload" with the missing-details alert.
- **Lists**: ref cell = `row.ref` with the APPL id as a muted second line on linked rows; `load-sheet.tsx` pins Appload at the top of the carrier picker (type filter `!== "shipper"`); partners transporters view shows a static pinned "Appload" card.
- **Dashboard/analytics**: `latest-orders.tsx` drops the `orders.list` query; `pipeline-tiles.tsx`, `needs-a-hand.tsx`, `analytics/sections/pipeline-tiles.tsx` keep `analytics.pipeline` counts and re-point hrefs into `/orders/[section]?tab=…`; `notifications/types` `/appload/quotes` → `/quotes`, `/appload/details/[orderId]` stays.
- **Map** (`map/server/procedures.ts`, `map/views/map-view.tsx`, `useMapSelection`, `map-selected-card`, table links): exclude order entities the tenant has a live linked row for; linked loads take `lastPosition` from `order_location`; selection `?id=` switches from ref to entity id (refs are no longer globally unique).
- **i18n** pt + en: `App.loads.appload.*`, `App.loads.errors.*`, `App.shell.sidebar.company.quotes`; remove `App.shell.sidebar.work.appload` and `App.orders.sections.*` when unused; grep `TRP` in messages and docs.

---

## 5. `movementRef` / `seq` call-site checklist
`movements/refs.ts` (new API); `movements/offer.ts` 135, 188, 238, CTE 287-321 (`'ORD-' || seq` → minted refs), 362; `movements/apply.ts` 168, 499, 549; `tracking/movement-slot.ts` 202, 232; `tracking/movement-review.ts` 338; `tracking/movements.ts` 45-49, 104 (+ consumer `apps/admin/src/app/api/chats/infobip/route.ts`); `threads/access.ts` 64, 72, 150, 155; portal `movements/server/projection.ts` 572; `movements/server/procedures.ts` 319, 496, 784, 1067, 1299, 1496, 1669, 1774; `search/server/procedures.ts` 55-69; `drivers/server/procedures.ts` 396, 410; map selection files; `apps/app/scripts/verify-movements.ts` ref assertions; messages/docs `TRP` copy. `movement.seq` stays for ordering and its unique constraint. Type fallout of the widened `organization.type`: guard with `isPartnerOrgType` at `movements/server/procedures.ts:609`, `partners/server/procedures.ts` (137, 172, 210, 618, 682), `onboarding/server/procedures.ts` (179, 249, 382, 534), `settings/server/procedures.ts`, admin `partners/server/procedures.ts` (496, 1149, 1497), `packages/trpc/src/tenant-gate.ts:90`.

---

## 6. Milestones

**M0 — Foundation (serial).** §1 (types, schema, 0022, dev scripts written and run on dev: columns, seed, renumber), `packages/domain` export `./appload/*`, `refs.ts` + `counters.ts` + `mirror.ts` + `appload/link.ts` with signatures (bodies `throw new Error("M2")`), `movementRef(row)` rewired at every §5 site, tenant-gate deny, `me.session` narrowing, type fallout, `LoadFormOptions` widened, `MovementRow.apploadOrderId` / `MovementDetail.appload` typed as null. Deliverable: typecheck/lint/build green, stored references visible, no behaviour change.

**M1 — Reference assignment (serial, short).** §2.1 wiring, search ilike (both sites), map selection by id, `verify-movements.ts` assertions, movement-door guards + `apploadLinked` in status/policy/apply/offer/update/requestLocation. Owns `packages/domain/src/movements/*`, portal `movements/server/*`, `search/*`, `map/*`, `drivers/server/*`.

**Then in parallel:**
- **M2 — Link + mirror.** `appload/link.ts` bodies, `orders/transition.ts` hook (only this agent), `orders/create.ts` hook + guard, `orders/next-order-id.ts`, `orders/policy.ts`, admin order procedure hooks, portal `orders/server/requests.ts` hooks, admin offer hook, tracking skips, `movements/link.ts` Appload short-circuits.
- **M3 — Order side-of-order + delegated procedures.** §3.3, §3.2, `formOptions` pin + `create` guard + `offer` routing (starts on `movements/server/procedures.ts` after M1).
- **M4 — Portal UI.** §4 except the map server.
- **M5 — Admin sign-in + company KYC in the portal.** §7 and §7b. Owns `apps/admin/src/backend/schemas/sign-in.ts`, the admin sign-in views and messages, `apps/app/src/frontend/pages/fleet/server/kyc.ts`, `fleet/sections/{papers-card,paper-upload}.tsx`, `apps/app/src/frontend/pages/settings/**`, `packages/edgestore/src/server.ts`, `settings.json`/`fleet.json`.

**M6 — Data + verification.** Backfill linked rows for non-terminal Appload orders of portal orgs (tsx harness calling `syncApploadLinks`), `verify-appload-partner.ts`, browser checks, `docs/appload-partner-design.md`, `RELEASE.md`, memory.

`orders/transition.ts` is M2's only; `movements/server/{procedures,projection}.ts` are M1's until M1 lands, then M3 (server) / M4 (types) never concurrently.

---

## 7. Admin sign-in tightening
`apps/admin/src/backend/schemas/sign-in.ts` `SignInSchema.username = z.string().nonempty(...).regex(/^[^@\s]+$/, { error: t("username.invalid") })`; same in the forgot-password schema; copy: en "Your staff username, @apploadafrica.com is added for you", pt formal ("Introduza o seu nome de utilizador"), plus `username.invalid` in both; `UsernameInput` unchanged.

## 7b. Company KYC uploads in the portal, contract Appload-only
State today (from the dispatch milestone): the portal uploads driver and vehicle papers through `apps/app/src/frontend/pages/fleet/server/kyc.ts` (`documents`, `upload`, `rigPapers`; subject types limited to driver/truck/trailer/link via `ORDER_DISPATCH_SUBJECT`) and the `PapersCard`/`PaperUpload` components in `fleet/sections/`; the organization's own papers are read-only in Settings except the signed contract, which the portal uploads via `settings/components/contract-upload-dialog.tsx` + `settings/server/procedures.ts uploadContract`; the `kycFiles` bucket (`packages/edgestore/src/server.ts`) admits staff, the org's own `organization/<orgId>/signed-contract`, and fleet subjects owned by the org. Required documents per kind live in `packages/domain/src/kyc/requirements.ts` (`REQUIRED_DOCS`, `CONTRACT_DOC`).
- **Portal router** `fleet/server/kyc.ts` (keep the mount name `kyc`): `documents` and `upload` accept `subjectType: "organization"` when `subjectId === ctx.tenant.organizationId`; `upload` refuses `type === CONTRACT_DOC` for tenants with `CONTRACT_APPLOAD_ONLY`; `tenantOwnsSubject` already treats the org as its own subject. Delete `settings.uploadContract` and its activity entry.
- **Bucket** `kycFiles.beforeUpload`: for non-staff, allow `organization/<ctx.orgId>/<type>` for every `REQUIRED_DOCS[orgKind]` type **except** `signed-contract`; keep fleet subjects; `replaceTargetUrl` still staff-only. Update the bucket comment.
- **Settings UI** `apps/app/src/frontend/pages/settings/`: replace the read-only company documents list and the contract dialog with `PapersCard subjectType="organization"` (generalize the card: `subjectKind` from `subjectKind(subjectType, orgType)`; slot list from `REQUIRED_DOCS[kind]`; the `signed-contract` slot renders status/expiry only with the copy "Uploaded by Appload after signature", never an upload control); gate uploads on `isOrgAuthorized(role, "kyc", ["upload"])`; invalidate `me.session`/verification queries after upload so the KYC badge and progress refresh. Delete `contract-upload-dialog.tsx`.
- **Admin** unchanged: `kyc.upload` (any subject, any type incl. the contract) and review stay; the partner profile sheet's Documents tab already shows pending uploads with their `uploadedBy`.
- **Notifications**: when a tenant uploads, no notification (ops see the pending-review queue); when ops approve/reject, the existing `writeDerivedStatus` path stands — add `kyc.reviewed` to the portal notification kinds only if it is cheap (optional, list in §9).
- i18n pt + en in `settings.json`/`fleet.json` for the organization slot labels (`nuit`, `id-card`, `commercial-certificate`, `alvara`, `bank-letter`, `republic-bulletin`, `commercial-exercise`, `signed-contract`) and the contract copy; fix docs (`docs/portal-design.md` "KYC uploads stay in Admin", `docs/kyc-revamp-design.md`).

---

## 8. Verification
- After every milestone: `pnpm turbo typecheck lint build`; after M0 `db:generate` emits nothing further and 0022 has no ALTER TYPE; dev scripts dry-run then `--yes`.
- `apps/app/scripts/verify-appload-partner.ts` (own world: shipper S, portal carriers C and D with owners, a staff user, C's papers; every row deleted, counters included): seed guard and NOT_PARTNER_ACCOUNT for a member of Appload; partners search never lists Appload, `formOptions` lists it first; S files a partner load with Appload → REQ-0001-YY, `offer` creates the APPL order (prospect, shipper S, source client), row `offered` under Partners › Procurement with partner "Appload", `movements.transition` → FOLLOWS_APPLOAD_ORDER, missing loading date → APPLOAD_NEEDS_DETAILS; sendRequests to C and D → candidate rows (offered, clientReference APPL, no ORD) in C's My trucks › Procurement, `railCounts.received` counts it, C quotes → prospect, withdraw D → cancelled; accept C → order booked, S's row booked with ORD-0001-YY and REQ kept and buy leg = shipper price, C's row booked with C's ORD-0001-YY and sell leg = carrier price, C `update` details → FIELD_LOCKED, costs/payments OK; staff dispatch → both at-loading, C's row carries driver/plate, `subscription_usage` only order rows, the movement tracking slot selects neither, S's map shows the load once with the order's ping; delivered mirrors; completed leaves delivered; both close after paying; un-book → S offered, C cancelled, re-book → new C row ORD-0002-YY; cancel while prospect → S declined + unlinked, after booked → both cancelled; C hands its own load to Appload → source carrier, shipper C, C may cancel; references: own-fleet create → ORD, `respondToOffer` owner+executor ORDs with executor `clientReference` = owner ref, 20 concurrent `nextReference` distinct, two companies both get 0001, ilike search hits, `linkedMovementId` resolves; `SignInSchema` accepts "claire", rejects "claire@x" and "cla ire". KYC: a tenant owner uploads an `alvara` for its own organization → row pending, `kycStatus` recomputed; the same tenant uploading `signed-contract` → `CONTRACT_APPLOAD_ONLY`; uploading for another organization → refused; staff `kyc.upload` of the contract on behalf still works; the `kycFiles.beforeUpload` rule (unit-call the hook with a fake ctx) admits `organization/<org>/alvara` for a member and refuses `organization/<org>/signed-contract` and `organization/<other>/alvara`.
- Browser (Claire's Chrome): Settings → Company documents card lets the owner add a NUIT scan, shows the contract slot read-only; admin partner sheet shows it pending with the uploader. Shipper new load with partner Appload → Send to Appload → load page with REQ ref + APPL badge, requests/offers panels, no Appload group, Procurement badge; old `/appload/*` URLs redirect. Carrier: Appload request in My trucks › Procurement with the APPL id, quote from the load page, ORD after booking, dispatch dialog from the load page, Booked badge, map selection by id. Admin: booking/dispatch/delivery updates both load pages; partner lists never show Appload; sign-in refuses `name@…`.

---

## 9. Risks and open items for Claire
1. Appload seed identity for prod: NUIT (unique, 9 digits), email, phone (dev uses placeholders).
2. Quotes page at `/quotes` under My company (alternative: inside Partners).
3. Defaults D3–D5: candidates at request time (lost ones end in History as cancelled), `booked → booked`, `completed` leaves the row `delivered`, linked rows only for portal-active organizations; backfill non-terminal orders only.
4. No transactions on neon-http: `syncApploadLinks` is best-effort after the order write, idempotent so the next transition or the backfill harness repairs it; minted ORD numbers before a failed claim leave gaps.
5. A carrier cannot subcontract an Appload load in the portal (offer/convert refused on linked rows).
6. `TRP-` disappears from copy, WhatsApp texts and confirmation PDFs; drivers see `ORD-…`.
7. Admin `order.update` now also writes movement rows (best-effort, never blocks ops).
8. `sync-dev-from-logbook.mjs` truncates `organization`: the Appload seed must re-run after every sync (script epilogue).
9. Company KYC: uploads by any member (default D9 from the previous plan) or owner/admin only; whether a tenant should be notified when ops approve or reject a paper (optional `kyc.reviewed` kind).
