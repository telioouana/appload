# Dispatch papers, loading check, and in-app load chat

_Plan by Fable 5.1 (2026-09-15) for implementation by Opus 5 Ultracode. Branch `stage/23-portal-demo` (clean). Grounded in three subsystem reads of `apps/admin`, `apps/app`, `packages/*` and a Plan-agent design pass._

## Context

Today a carrier is booked by accepting an `order_offer`, and the driver + rig are assigned later on the `booked → to-loading` move ("dispatch"). Nothing ties the papers of that driver and truck to the order, and nothing at the loading site checks that the truck and driver who turned up are the ones that were submitted. The only party-to-party channel is WhatsApp with the driver (Infobip-mirrored `chat_conversation`), which has no participants, no files, and is global per phone number.

Claire's decisions (this session):

| Topic | Decision |
|---|---|
| Scope | Appload brokerage `order` first; domain modules shared so portal `movement` can adopt. Chat covers both from the start. |
| When papers are due | At dispatch, before loading. `to-loading` is **removed**: `booked → at-loading` (same as movements). |
| Papers source | The KYC store (`kyc_document`), **opened to carriers** in the portal for their own drivers/vehicles. Each dispatch snapshots what was on file. |
| Loading check | The **orderer** confirms before loading starts: ops in admin or the shipper in the portal (whoever does it is recorded); carrier read-only. Items: `driver-identity`, `rig-plates`. |
| Mismatch | Flag `LOADING_MISMATCH` + manager & note to proceed (flag never blocks on its own). |
| Skipped | Moving `at-loading → loading` without a completed check proceeds, but the order is flagged `LOADING_CHECK_SKIPPED`, with an `order_history` row and an activity-log entry naming who moved it. |
| Tracking | WhatsApp pings start **after the truck leaves loading** (`on-route` onward), for orders and portal loads. Billing unchanged. |
| Chat parties | Appload order: shipper + carrier (once booked) + Appload ops, one thread. Portal load: owner + executing partner only, **no ops**. Driver stays on WhatsApp (existing thread shown alongside, unchanged). |

Decisions taken in this plan (one line each to change): D1 pg enum keeps `to-loading`, only the TS vocabulary drops it. D2 historic `to-loading` rows → `at-loading`. D3 dispatch edge = exactly `booked → at-loading` (resumes from `stopped/issue` are not dispatches). D4 required papers: driver = current `driver-license` **or** `id-card`; each vehicle = current `vehicle-booklet` (`proof-of-ownership` not required; ownership stays a reviewer concern). D5 "present" = current, non-rejected; `pending` is present and raises flag `PAPERS_UNREVIEWED`. D6 missing papers **block** dispatch in every `KYC_ENFORCEMENT` mode (payload requirement, like the rig). D7 pack re-snapshotted when admin edits the rig on an on-going order. D9 new org permission `kyc: [read, upload]` for owner/admin/member. D10 carrier joins the order thread only while `carrierId` set and status ≠ `prospect`; movement thread = owner org + `carrierOrgId`; the executor's linked row resolves to the parent's thread. D12 `thread.message` notification, `email: false` (Claire to decide on email; if yes, throttle per thread per hour). D13 admin Messages page gets a "Drivers | Order chats" toggle, order page gets a ChatCard. D15 `SHOW_APPLOAD` → `true` (dispatch, papers, check and chat live on `/appload/details/[orderId]`).

Conventions verified: vocabularies are text + `as const` (never pgEnum); migrations additive (`pnpm --filter @workspace/db db:generate`, next is `0021`); `applyTransition` (`packages/domain/src/orders/transition.ts:357`) is the one status door; flags via `gateFlagReason`/`parseFlagReason`; activity log via `registerActivityCatalog` (`packages/trpc/src/activity-log.ts:35`); tenancy via `tenantProcedure`/`authorizedTenantProcedure`; staff via `authorizedProcedure`. EdgeStore awaits `beforeUpload`, so async hooks are fine. `.$type<>()` narrows drizzle column types (drizzle-orm 0.45.2).

---

## 1. Schema (all additive, one migration `0021_dispatch_check_threads`)

### 1.1 `packages/db/src/types/index.ts`
- Split: `ORDER_STATUS_ENUM` (pg enum values, keeps `to-loading`) and `ORDER_STATUS` (vocabulary, without it). `OrderStatus` derives from the latter. Add `LEGACY_ORDER_STATUS_ALIAS: Record<string, OrderStatus> = { "to-loading": "at-loading" }`.
- Add `ORDER_DISPATCH_SUBJECT = ["driver","truck","trailer","link"]`, `LOADING_CHECK_ITEM = ["driver-identity","rig-plates"]`, `LOADING_CHECK_OUTCOME = ["passed","mismatch","skipped"]`, `THREAD_SUBJECT = ["order","movement"]`.

### 1.2 `packages/db/src/schemas/orders.ts`
- `orderStatusEnum = pgEnum("order_status_enum", ORDER_STATUS_ENUM)`; `order.status` and `orderHistory.fromStatus/toStatus` get `.$type<OrderStatus>()` (history: `OrderStatus | "to-loading"`). `db:generate` must emit **no** `ALTER TYPE`.
- `ORDER_DOCUMENT_TYPE` += `"loading-photo"`; `ORDER_HISTORY_KIND` += `"check"`.
- New tables:
  - `order_dispatch`: id, order_id FK restrict, driver_id FK set null, driver_name/phone/passport snapshots, truck_id/trailer_id/link_id (no FK), truck/trailer/link_plate snapshots, dispatched_by FK user set null, dispatched_at, superseded_at, superseded_by. Index `(order_id, dispatched_at)`; partial unique `(order_id) where superseded_at is null`.
  - `order_dispatch_document`: dispatch_id FK cascade, subject_type (ORDER_DISPATCH_SUBJECT), subject_id, kyc_document_id (no FK), type (KYC_DOCUMENT_TYPE), status_at_snapshot, expires_at date. PK `(dispatch_id, kyc_document_id)`.
  - `order_loading_check`: id, order_id FK restrict, dispatch_id FK restrict nullable, items jsonb `{key, ok: boolean|null, note?}[]`, outcome (LOADING_CHECK_OUTCOME), photo_document_ids jsonb string[], note, checked_by FK user set null, checked_by_org_id FK organization set null (null = staff), checked_at. Index `(order_id, checked_at)`.

### 1.3 `packages/db/src/schemas/threads.ts` (new; export from `schema.ts` + `package.json`)
- `thread`: id, subject_type (THREAD_SUBJECT), subject_id, created_at, last_message_at. Unique `(subject_type, subject_id)`.
- `thread_participant`: thread_id FK cascade, organization_id FK set null (null = staff side), staff boolean. Partial uniques `(thread_id, organization_id) where organization_id is not null` and `(thread_id) where staff`. Index `(organization_id)`.
- `thread_read`: thread_id, user_id, last_read_at. PK `(thread_id, user_id)`.
- `thread_message`: id, thread_id FK cascade, sender_user_id FK set null, sender_org_id FK set null (null = staff), body default '', attachments jsonb `{url,name,size,mimeType}[]` default `[]`, created_at. Index `(thread_id, created_at)`. CHECK `length(body) > 0 or jsonb_array_length(attachments) > 0`.

### 1.4 Other
- `packages/db/src/schemas/notifications.ts` `NOTIFICATION_KIND` += `"thread.message"`.
- `packages/auth/src/permissions/org.permissions.ts`: `thread: ["read","send"]` and `kyc: ["read","upload"]` for owner/admin/member.
- `packages/edgestore/src/path.ts`: `threadAttachmentPath(threadId) = toStoragePath(\`threads/${threadId}\`)`.
- `packages/db/scripts/sync-dev-from-logbook.mjs` TRUNCATE list (~line 785): add `thread_message, thread_read, thread_participant, thread, order_loading_check, order_dispatch_document, order_dispatch`.
- New `packages/db/scripts/retire-to-loading.mjs` (same `--yes` rails as the sync script; prints counts first): `UPDATE "order" SET status='at-loading', version=version+1 WHERE status='to-loading'` + one `order_history` row per moved order (`kind 'system'`, metadata `{retiredStatus}`); flag `--backfill-dispatch` inserts an `order_dispatch` (+ documents from the subjects' current docs) for on-going orders that have a rig and no open pack (`dispatched_by null`).
- Sheet mappings: delete `"to-loading": "To Loading"` at `apps/admin/src/lib/orders/orders-sheet-mapping.ts:55`; `packages/db/scripts/logbook-mapping.mjs:105` and `import-orders-sheet.mjs:148` map `"to loading"` → `"at-loading"`; comment at `logbook-mapping.mjs:297`.

---

## 2. Domain (`packages/domain`)

### 2.1 Remove `to-loading` (`src/orders/`)
- `transitions.ts`: drop from `RANK` and `FORWARD` (`booked: ["at-loading"]`); line 139 lower bound becomes `rank("at-loading")`; header comment line 14.
- `policy.ts:25-26` `CARRIER_FORWARD`: `booked: ["at-loading"]`.
- `derive.ts:50`, `milestones.ts:33`, `status-groups.ts:24,65` (`PRE_LOADING_STATUSES = ["booked","at-loading"]`): drop the entry. Add `ON_GOING_STATUSES` export to status-groups.
- `transition.ts`: replace every `input.to === "to-loading"` (lines ~398, 443, 465, 621) with `isDispatchMove(current.status, input.to)`; `resumeFromHistory`/`deriveResumeStatus` map through `LEGACY_ORDER_STATUS_ALIAS`.
- `milestones.ts` `deriveMilestones`: alias legacy history `toStatus` so old `to-loading` rows light the `at-loading` step.
- `schemas.ts:120`, `dispatch-readiness.ts:5`: comments.

### 2.2 Dispatch readiness + papers
`src/orders/dispatch-readiness.ts` (client-safe) adds:
```ts
export const isDispatchMove = (from, to) => from === "booked" && to === "at-loading"
export const DISPATCH_DRIVER_DOCS = ["driver-license","id-card"]   // any one
export const DISPATCH_VEHICLE_DOCS = ["vehicle-booklet"]           // each vehicle
export type PaperSubject = { kind: "driver"|"truck"|"trailer"|"link"; subjectId; label; docs: {type; status}[] }
export type PaperGap = { kind; subjectId; label; needs: KycDocumentType[] }
export function missingPapers(subjects): PaperGap[]
export function unreviewedPapers(subjects): PaperSubject[]
export type DispatchReadiness = { fields: DispatchField[]; papers: PaperGap[]; unreviewed: PaperSubject[] }
```
New `src/orders/dispatch-papers.ts` (server-only): `loadRigSubjects(db, rig)` (driver by id, vehicles by plate via `VEHICLE_TABLE`; extract and export the lookup from `kyc/order-gate.ts` `loadPartySubjects`; docs via `currentDocuments`) and `loadDispatchReadiness(db, row)`.

`src/kyc/enforcement.ts`: `SubjectFlag.papers?: "missing"|"pending"|"ok"`; `gateFlagReason` emits `PAPERS_UNREVIEWED: <labels>` when every unverified subject only lacks review. `src/kyc/flag-reason.ts` `FLAG_REASON_CODES` += `PAPERS_UNREVIEWED`, `LOADING_MISMATCH`, `LOADING_CHECK_SKIPPED`. `order-gate.ts` `loadPartySubjects` fills `papers`.

`transition.ts` on `isDispatchMove`: (1) `assertTrackingAllowance` unchanged; (2) `loadDispatchReadiness` → `INCOMPLETE_FOR_DISPATCH` / `BAD_REQUEST PAPERS_MISSING` (cause = gaps); (3) `guardOrderGate` unchanged; (4) after the order update, `recordDispatch(...)`, history metadata gains `dispatchId`; (5) `recordTrackingUsage` unchanged position.

### 2.3 Dispatch pack `src/orders/dispatch-pack.ts` (server-only)
`recordDispatch(db, {orderPk, row, actor})` (supersede open pack, insert pack + documents from `currentDocuments`), `loadDispatchPack(db, orderPk)` (open pack joined to `kyc_document`, pages via `withProxiedPages`, grouped by subject), `rigChanged(patch, current)`. Admin `order.update` calls `recordDispatch` when `rigChanged` and status is on-going (D7).

### 2.4 Loading check
`src/orders/loading-check.ts` (pure): `LoadingCheckItemResult`, `deriveOutcome(items)` (any false → mismatch; all true → passed; else skipped), `LoadingCheckState = { state: "none"|"passed"|"mismatch"|"partial"; check }`, `loadingMoveRequirements(state, actor)` → `{ blocked: "LOADING_MISMATCH_REVIEW_REQUIRED"|"MANAGER_REQUIRED"|null; note: boolean; skippedFlag: boolean }` (mismatch: tenant blocked; staff without `risk:flag` → MANAGER_REQUIRED, the same manager proxy `guardOrderGate` uses; manager → note required. none/partial → `skippedFlag`), `LoadingCheckInputSchema` (orderId, expectedVersion, 2 items, note ≤2000, photoDocumentIds ≤10).

`src/orders/loading-check-store.ts` (server-only): `loadLoadingCheckState(db, orderPk, dispatchId)`, `recordLoadingCheck(db, {current, actor, input, expectedVersion})` → inserts the check; on mismatch writes the flag quartet (`LOADING_MISMATCH: driver-identity, rig-plates — note`) under the optimistic lock; history row `kind: "check"` with `{checkId, outcome, items, previousFlagReason}`.

`transition.ts` when `input.to === "loading"` and `current.status !== "loading"`: load pack + state, `loadingMoveRequirements`; throw on `blocked`; `note && !input.note` → `NOTE_REQUIRED`; `skippedFlag` → fold `LOADING_CHECK_SKIPPED[: partial] — note` flag into the update, add a second history row `kind: "check"` `{skipped: true, partial, movedBy}`; transition history metadata gains `loadingCheck: state.state`. Procedure output carries `loadingCheck` so the activity catalog logs it.

### 2.5 KYC shared door
- `src/kyc/upload.ts` (server-only): `uploadKycDocument(db, {subject, type, pages, issuedAt?, expiresAt?, documentNumber?, uploadedBy})` extracted from `apps/admin/src/backend/api/routers/kyc.ts:124-163` (requirement check, `isKycUrl` per page, supersede chain, `writeDerivedStatus`). Admin router calls it.
- `src/kyc/tenant-access.ts` (server-only): `tenantOwnsSubject(db, tenant, subjectType, subjectId)`; `tenantCanReadKycDocument(db, tenant, doc)` = owns the subject **or** the doc id is in an `order_dispatch_document` of an order where the tenant is shipper or carrier.
- `src/kyc/file-proxy.ts` (server-only): `streamKycPage(document, index)` moved from `apps/admin/src/app/api/kyc/file/[documentId]/[page]/route.ts:59-131`; the admin route keeps its gate and delegates.

### 2.6 Threads `src/threads/` (add `"./threads/*"` to `packages/domain/package.json` exports)
- `access.ts`: `resolveThreadSubject(db, subject, actor)` → `{subject, sides: {orgIds, staff}, label}` (order: `[shipperId, carrierId if booked]`, staff true; movement: parent row if `executionMovementId` points at it, `[organizationId, carrierOrgId?]`, staff false); `threadAccess(actor, sides)` pure.
- `queries.ts`: `ensureThread` (upsert thread + participants), `getThread`, `listMessages(threadId, {before?, limit 50})` with `senderName`, `unreadForUser(actor)` (`thread_message` newer than `thread_read.last_read_at`, sender ≠ me, threads where the actor's side participates), `listStaffThreads` (admin Messages tab: thread + order + parties + preview + unread).
- `send.ts`: `ThreadAttachmentSchema` (url, name ≤200, size ≤10 MiB, mime pdf/jpeg/png), `assertThreadAttachmentUrl(url, threadId)` (EdgeStore host, `/_public/`, contains `/threads/<threadId>/`, shaped like `isKycUrl`), `sendMessage` (ensureThread, insert, bump `last_message_at`, markRead for sender, `notify()` other sides' members with `kind "thread.message"`, `dedupeKey "thread-message:<id>"`, `email: false`), `markRead`.
- Notification catalogs are typed exhaustively: add `thread.message` to `src/notifications/materialize.ts`, `apps/app/src/lib/notification-email.ts`, `apps/app/src/frontend/pages/notifications/types/index.ts` (`KIND_FAMILIES` += `messages`), `notifications.json` pt/en.

### 2.7 Tracking start
`src/tracking/statuses.ts` `TRACKED_STATUSES = ["on-route","stopped","issue","at-border","at-offloading","offloading"]`. Consumers:

| Consumer | Use |
|---|---|
| `apps/admin/src/lib/tracking/run-slot.ts:52` (ping set), `tracking/movement-slot.ts:84`, `apps/app/.../map/components/order-route-map.tsx:31`, `apps/app/.../analytics/server/procedures.ts:216` | keep `TRACKED_STATUSES` |
| `tracking/locations.ts:59` (pin attribution), `apps/admin/.../chats.ts:287` (manual ping), map working sets `apps/admin/.../map/server/procedures.ts:188`, `apps/app/.../map/server/procedures.ts:104`, `apps/app/.../orders/server/projection.ts:183,196` | `ON_GOING_STATUSES` |
| `tracking/conversations.ts:12` `FOLLOW_UP_STATUSES`, `open-chat-button.tsx:18`, `chats-view.tsx:31` | `ACTIVE_STATUSES` |
| `transition.ts:621` `recordTrackingUsage` | `isDispatchMove` (billing unchanged) |

Movements: add `TRACKED_STATUSES` (same list) to `src/movements/status.ts`; use it in `tracking/movement-slot.ts:96` (cron send set) and `movement-review.ts:158`. Keep `MOVEMENT_IN_PROGRESS_STATUSES` for billing, pin attribution (`tracking/movements.ts:60`) and manual `requestLocation`. Fix the comments at `movements.ts:68` and `status.ts:39-43` that call it "what the cron tracks".

---

## 3. Routers

### 3.1 Admin
- `frontend/pages/order/server/procedures.ts`: `transitionOptions` (~1032-1117) drops the to-loading branch; `to === "at-loading" && status === "booked"` → `loadDispatchReadiness` → `blockedReason INCOMPLETE_FOR_DISPATCH | PAPERS_MISSING` + `dispatch: {missingFields, missingPapers, unreviewed}`; `to === "loading"` → `loadingCheck` state, `MANAGER_REQUIRED`, and `"note"` requirement on mismatch. `update` gets the D7 hook. New `loadingCheck` (`order:read` → pack, state, photos, `canCheck`) and `recordLoadingCheck` (`order:update`). Photos go through existing `documents.create` (`documents-procedures.ts:282`) with type `loading-photo`.
- `backend/api/routers/kyc.ts`: `upload` delegates to `uploadKycDocument`; new `subjectPapers` (`kyc:read`, rig → `PaperSubject[]` proxied).
- New `backend/api/routers/threads.ts` mounted `threads` in `_app.ts`: `get`, `messages`, `send`, `markRead`, `unread`, `list` on `authorizedProcedure("chat", …)`; staff can never open a movement thread (`sides.staff === false`).
- Activity catalog: `order.recordLoadingCheck {orderId, outcome, mismatchItems, photoCount}`, `order.transition` += `loadingCheck, dispatchId`, `threads.send {subjectType, subjectId, attachmentCount}`, `threads.markRead`. Never URLs. `ActivityLog.*` keys in `messages/{en,pt}.json` (admin dev server restart after JSON edits).
- `app/api/kyc/file/[documentId]/[page]/route.ts` → gate + `streamKycPage`.

### 3.2 Portal
- `frontend/pages/orders/server/procedures.ts`: `transitionOptions` (694-770) gated target `booked → at-loading`, `loadingCheck` state, `MANAGER_REQUIRED`/`LOADING_MISMATCH_REVIEW_REQUIRED` for `loading`; `transition` (1017-1097): `isDispatchMove` → `DISPATCH_REQUIRED`; split `writeDispatch` (1227-1309) into `resolveDispatch` (ids → rows/plates) + `writeDispatch`; run `loadDispatchReadiness` on the resolved rig **before** writing so a refused move never lands the rig; then `applyTransition` re-checks. `PARTNER_DOCUMENT_TYPES` (`backend/schemas/dispatch.ts:26`) += `loading-photo` (shipper). New `loadingCheck` (tenant, `isMine`; carrier `canCheck: false`) and `recordLoadingCheck` (`authorizedTenantProcedure("order",["update"])`, shipper org only, owns order).
- New portal `kyc` router (`frontend/pages/fleet/server/kyc.ts`, mounted `kyc`): `documents` (`kyc:read`, `tenantOwnsSubject` → proxied `currentDocuments`), `upload` (`kyc:upload`, `tenantOwnsSubject` → `uploadKycDocument`), `rigPapers` (`kyc:read`). Catalog `kyc.upload {subjectType, subjectId, type}`.
- New `app/api/kyc/file/[documentId]/[page]/route.ts` in the portal (same path shape so `withProxiedPages` hrefs work): session → `getTenantGates` → `tenantCanReadKycDocument` → `streamKycPage`.
- `packages/edgestore/src/server.ts:169-187` `kycFiles.beforeUpload` becomes async and additionally accepts `ctx.orgId !== null && subjectType ∈ {driver,truck,trailer,link} && (await resolveKycSubjectOwner(subjectType, subjectId)) === ctx.orgId`. The package has no db dependency: `createEdgeStoreHandler` gains an optional `resolveKycSubjectOwner` captured in module scope (`configureEdgeStore`) by the host routes (admin passes it too; staff still short-circuits). Update the bucket comment at 128-132.
- New `frontend/pages/threads/server/procedures.ts` mounted `threads`: `get/messages/send/markRead/unread` on `authorizedTenantProcedure("thread", …)`; subject `{subjectType, subjectId}`; movement ids resolve via `resolveThreadSubject`. Catalog `threads/server/activity.ts`.
- `frontend/pages/orders/server/activity.ts` += `orders.recordLoadingCheck`; `orders.transition` += `dispatch`, `loadingCheck`.

---

## 4. UI

### 4.1 Shared kit `packages/ui/src/customs/chat/`
`thread-panel.tsx` (`ChatThread` on `MessageScroller*`/`Message*`/`Bubble*` from `packages/ui/src/components/`, attachments rendered with the currently unused `attachment.tsx` as new-tab links) and `composer.tsx` (`ChatComposer` on `input-group.tsx` + `Textarea`, hidden `<input type=file>` pattern from `apps/app/.../movements/sections/documents-card.tsx:352-370`). Props-only; labels passed in.

### 4.2 Portal
- `sidenav.tsx:56` `SHOW_APPLOAD = true`. Unread from `threads.unread` polled at `UNREAD_POLL_MS`; fold into the bell (notifications carry `thread.message`) plus a pill on the Appload group.
- `orders/sections/transition-dialog.tsx`: `needsRig = isDispatchMove(status, to)`; after picking driver/truck/trailer/link query `kyc.rigPapers` and render a Papers block per subject: present (status badge) or missing → inline `PaperUpload` (new `fleet/sections/paper-upload.tsx`, port of admin `kyc/sections/document-upload.tsx`: `kycFiles` two-phase, 5 MiB, 5 pages, `kyc.upload`); confirm disabled while gaps exist. For `to === "loading"`: none/partial → amber "will be recorded as unchecked"; mismatch → blocked alert. Error keys `PAPERS_MISSING`, `DISPATCH_REQUIRED`, `LOADING_MISMATCH_REVIEW_REQUIRED`, `MANAGER_REQUIRED` in `orders/lib/errors.ts` + `orders.json`.
- `orders/sections/transition-bar.tsx:86`: icon test `primary.to === "at-loading" && status === "booked"`.
- `drivers/views/driver-profile-sheet.tsx` (~224) and `fleet/views/vehicle-profile-sheet.tsx` (~239): `PaperUpload` per missing/rejected slot from `REQUIRED_DOCS[kind]`, gated on `isOrgAuthorized(role,"kyc",["upload"])`; previews via `kyc.documents` (small `PaperPreview`: `<img>` / `<object>` against `/api/kyc/file/...`). Fix the "uploads stay in Admin" comments (`fleet/sections/badges.tsx:11-16`, `backend/schemas/register-fleet.ts:56-60`).
- New `orders/sections/loading-check-card.tsx`: dispatch pack (driver + paper previews, each vehicle plate + booklet preview) and, for `isMine && orgType === "shipper"`, the checklist form (two rows: ok / not ok / untouched + note, photo picker → `documents.add` type `loading-photo` via `orderDocumentPath`, submit → `orders.recordLoadingCheck`); everyone else read-only. Mount in `orders/views/order-detail-view.tsx` left column after `OperationsCard` when status ≥ at-loading and (pack exists or state ≠ none).
- New `threads/sections/chat-card.tsx` (`ChatCard({subjectType, subjectId})`): `threads.get` + `threads.messages` at `THREAD_POLL_MS = 5_000` while mounted; `markRead` on open and on new inbound (effect pattern of admin `chats-view.tsx:139-144`); attach → `edgestore.apploadFiles.upload({input: {path: threadAttachmentPath(threadId)}, options: {temporary: true}})` → `threads.send` → `confirmUpload`. Mount in `orders/views/order-detail-view.tsx` right column under `TrackingCard`, and in `movements/views/movement-detail-view.tsx` right column above the WhatsApp `ThreadCard` for `role !== "client"`.
- i18n pt + en: `orders.json`, `loads.json`, `fleet.json`, `drivers.json`, `notifications.json`, new `threads.json` (register in `messages/index.ts`). Keep `status.to-loading` labels where history rows render; remove from `partners.json` `order-status` filter.

### 4.3 Admin
- `order/sections/operations-card.tsx:17` `AWAITING_ASSIGNMENT = ["booked"]`; papers line per subject (`kyc.subjectPapers`) linking to the partner review sheet when missing.
- `order/components/kyc-gate-banner.tsx`: show missing/unreviewed papers; `PAPERS_UNREVIEWED` label in flag reasons.
- `orders/components/transition-dialog.tsx:43`: `PAPERS_MISSING` (list gaps), `MANAGER_REQUIRED`; loading-check state + note field on mismatch for `to === "loading"`.
- New `order/sections/loading-check-card.tsx` (form enabled on `order:update`, photos via `documents.create`), mounted in `order/views/order-details-view.tsx` after `OperationsCard`.
- `order/sections/exception-banners.tsx`: `parseFlagReason` handles the new codes once translation keys exist.
- New `order/sections/chat-card.tsx` mounted under `TrackingCard`.
- Messages page (`chats/views/chats-view.tsx`, `chats/sections/conversation-list.tsx`): "Drivers | Order chats" segmented control; Order chats mode lists `threads.list` (polled `CONVERSATIONS_POLL_MS`), centre = shared `ChatThread`, right = `OrderPanel` with the thread's order id; deep link `?t=<threadId>` beside `?c=`. `sidenav.tsx:87` Messages badge = `chats.unread + threads.unread`.
- `messages/{en,pt}.json`: `Admin.orders.detailPage.loadingCheck`, `.dispatchPack`, `Admin.messages.threads`, error keys, flag reason labels, `ActivityLog.*`; remove `to-loading` from the list filter options (~1766) and form select (~1326).

---

## 5. `to-loading` removal checklist

| File | Change |
|---|---|
| `packages/db/src/types/index.ts:21` | split `ORDER_STATUS_ENUM` / `ORDER_STATUS`; `LEGACY_ORDER_STATUS_ALIAS` |
| `packages/db/src/schemas/orders.ts:20,103,278-279` | enum from `ORDER_STATUS_ENUM`; `.$type<OrderStatus>()` |
| `packages/domain/src/orders/{transitions:14,54,71-72,139; policy:25-26; transition:393-400,443,465,621; derive:50; milestones:33; status-groups:24,65; dispatch-readiness:5; schemas:120}.ts` | as §2.1 |
| `packages/domain/src/tracking/statuses.ts:9` | §2.7 |
| `packages/ui/src/customs/badge/status-badge.tsx:6,21` | keep the token (legacy history rows render it) |
| `apps/admin/src/frontend/pages/order/sections/operations-card.tsx:17`, `order/server/procedures.ts:1090` | `booked` only; dispatch target `at-loading` |
| `apps/admin/src/lib/orders/orders-sheet-mapping.ts:55` | delete entry |
| `apps/app/src/backend/schemas/dispatch.ts:9,68` | comments |
| `apps/app/src/frontend/pages/orders/{server/procedures.ts:733-751,1007-1051; sections/transition-bar.tsx:86; sections/transition-dialog.tsx:73,121}` | dispatch edge |
| `apps/app/src/frontend/pages/movements/types/index.ts:130` | `"booked": "booked"` |
| `packages/db/scripts/{logbook-mapping.mjs:105,297; import-orders-sheet.mjs:148}` | `"to loading"` → `at-loading` |
| `docs/portal-design.md`, `docs/kyc-revamp-design.md:246`, `RELEASE.md:384` | wording |

`allowedTransitions` iterates `ORDER_STATUS`, so the value disappears from every select; `validateTransition` refuses it with `INVALID_STATE`.

---

## 6. Milestones

**M0 — Foundation (serial).** All of §1, package exports, `retire-to-loading.mjs` (not run), plus only the mechanical §5 edits needed for `pnpm turbo typecheck` to pass with edges pointing `booked → at-loading`. Deliverable: green tree, no new behaviour.

**Parallel after M0:**
- **M1 — Dispatch edge + tracking.** Rest of §2.1, §2.7 (orders and movements), `transitionOptions`/`transition` rewiring in both apps, status message JSON, docs. Owns `transition.ts`.
- **M2a — Portal KYC.** §2.5, portal `kyc` router + proxy route, EdgeStore hook widening, `PaperUpload` + profile sheets, permission, i18n. No `transition.ts`.
- **M4 — Chat backend.** §2.6, both routers, catalogs, notification kind wiring, i18n keys. Only `_app.ts` mounts overlap.

**Then:** **M2b — Papers in dispatch** (§2.2, §2.3, `transition.ts` dispatch block, portal pre-check + `writeDispatch` split, dispatch dialog papers block, admin `subjectPapers`/banner/operations card, D7 hook, `--backfill-dispatch`) after M1. **M5 — Chat UI** (§4.1, ChatCards, Messages toggle, badges, i18n) after M4.

**Then:** **M3 — Loading check** (§2.4, `transition.ts` loading block, `loadingCheck`/`recordLoadingCheck` in both apps, `loading-photo` in both document dialogs, both LoadingCheckCards, transition dialogs, flag labels, catalogs, i18n, `SHOW_APPLOAD = true`) after M2b.

**Finally:** **M6 — Data + verification.** Run `retire-to-loading.mjs --yes --backfill-dispatch` on dev, write and run the verify scripts, update docs and the memory notes.

`transition.ts` is edited by M1, M2b, M3 in sequence, never concurrently.

---

## 7. Verification

- After every milestone: `pnpm turbo typecheck lint build`. After M0: `pnpm --filter @workspace/db db:generate` produces nothing further and the SQL has no `ALTER TYPE`; `db:migrate` on the dev branch; `node packages/db/scripts/retire-to-loading.mjs` dry run then `--yes`.
- Scripts modelled on `apps/app/scripts/verify-movements.ts` (`NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/<name>.ts`, explicit tenant contexts, rows deleted at the end):
  - `verify-dispatch.ts`: carrier without driver papers → `booked → at-loading` refused `PAPERS_MISSING`; after `kyc.upload` (pending) dispatch succeeds, order flagged `PAPERS_UNREVIEWED`, `order_dispatch` + documents written, usage row written; resume from `stopped` creates no second pack; `at-loading → loading` with no check → `LOADING_CHECK_SKIPPED` flag + history `check` row + activity row; shipper records mismatch → `LOADING_MISMATCH`, carrier `loading` refused `LOADING_MISMATCH_REVIEW_REQUIRED`, staff user `MANAGER_REQUIRED`, manager with note passes; `transitionOptions` never offers `to-loading`; tracking cron selects nothing for an order at `at-loading`.
  - `verify-threads.ts`: shipper sends before booking → carrier candidate cannot read; after booking carrier reads/sends; stranger refused; staff reads order thread, cannot read a movement thread; executor's linked row resolves to the owner's thread; client role refused; per-user unread; attachment URL outside `/threads/<id>/` refused; one notification per message per recipient.
- Browser (Claire's Chrome per memory): Admin — booked order whose driver lacks a licence: dialog names the gap; upload from the partner sheet; dispatch; Loading check card previews the pack through `/api/kyc/file`; submit mismatch; banner shows `LOADING_MISMATCH`; move to loading as manager with note; Messages "Order chats" tab with unread pill; send a PDF. Portal carrier — dispatch dialog papers per pick with inline upload; profile-sheet upload; chat on an order page and on a load page beside the WhatsApp card. Portal shipper — checklist with photo; chat; bell shows `thread.message`. Both — history renders `check` rows and legacy `to-loading` transitions.

---

## 8. Risks and items for Claire

1. `.$type<>()` on the pgEnum column must narrow `$inferSelect`; if drizzle-kit diffs the column, keep the pgEnum builder and narrow at the type layer only.
2. neon-http has no transactions: `recordDispatch` after the order update can fail, leaving an at-loading order without a pack; the check card must tolerate `pack === null` (legacy rows do too).
3. Chat attachments and loading photos are public-if-URL-known (same as order documents today; `packages/edgestore/src/server.ts:113-137`). KYC pages stay behind the proxy. Protected files remain the fix, out of scope.
4. Both apps must keep serving `/api/kyc/file/[documentId]/[page]` at the same path.
5. `flagReason` holds one reason: a later `LOADING_MISMATCH` replaces `PAPERS_UNREVIEWED` on the row; the previous reason is kept in the history metadata.
6. A `stopped` truck whose resume target precedes `on-route` is still pinged (orders and movements alike); acceptable for now.
7. Run `retire-to-loading.mjs` before the next sheet-sync tick or expect one round of `SHEET_FAILED` warnings for "To Loading" rows.
8. Claire decides: email on `thread.message` (default off), and whether members (not only owner/admin) may upload papers (D9 default yes).
