# KYC & Registration Pipeline — Design Document

_Admin revamp for Shippers, Carriers, Drivers, and Fleet (trucks/trailers/links)._
_Grounded in the current codebase (Aug 2026) and the Conecta app (`E:\Appload\conecta\appload-app`)._

---

## 0. What exists today (baseline)

| Area | State |
|---|---|
| `kyc` table | Exists (`packages/db/src/schemas/users.ts`) — 1:1 with `organization`, 7 jsonb `Urls` slots, **never written**. No status, reviewer, dates, or expiry. |
| Fleet/driver doc columns | `driver.driverLicense`/`passportCard`, `truck/trailer/link.booklet`/`license` exist, **never populated** (deferred intentionally). |
| Verification state | Only `organization.status` (`pending`/`active`/`closed`) — defaults to `pending`, nothing ever transitions it. |
| File storage | EdgeStore fully wired: single `apploadFiles` bucket, `FileInput` with `upload` + `deferred` modes, two-phase commit support. |
| Permissions | `uac` (staff) has `organizations` incl. `block`, but **no `kyc` resource**. `fleet` + `organizations` routers use bare `protectedProcedure` — **any authenticated user can call them** (must fix). |
| Pages | `/shippers`, `/carriers/all`, `/carriers/drivers`, `/carriers/fleets` exist in nav + pt route aliases but **404** — no pages built. |
| List UI | Orders pattern: card grid/list, URL-driven filters, cursor infinite scroll, parallel routes `@header`/`@stats`/`@data`. No data-table abstraction anywhere. |
| State machines | `apps/admin/src/lib/orders/transitions.ts` — pure shared module, server re-guards, client renders. The model to copy. |
| Migrations | No `drizzle/` dir. Changes go out via `db:push` + hand scripts in `packages/db/scripts/`. **Shared Neon DB — pg enum `ALTER TYPE` is hazardous; new status vocabularies must be `text` + TS const** (same rationale documented in `order-documents.ts`). |

---

## 1. Document model — replace jsonb slots with a `kyc_document` table

The jsonb-slot approach (`kyc.idCard`, `truck.booklet`, …) cannot carry per-document status, reviewer, expiry, or resubmission history. Model documents the way `order_document` already models attachments: **one polymorphic, append-only table**.

```ts
// packages/db/src/schemas/kyc-documents.ts
// type/status are text + TS const, NOT pg enums — adding a doc type must never
// require ALTER TYPE on the shared database (same rule as order_document.type).

export const KYC_SUBJECT_TYPE = ["organization", "driver", "truck", "trailer", "link"] as const

export const KYC_DOC_TYPE = [
    // organization
    "nuit", "id-card", "commercial-certificate",
    "alvara", "bank-letter", "republic-bulletin", "commercial-exercise",
    "signed-contract",
    // driver
    "driver-license", // id-card is shared
    // vehicle
    "vehicle-booklet", "proof-of-ownership",
] as const

export const KYC_DOC_STATUS = ["pending", "approved", "rejected"] as const
// "expired" is NEVER stored — it is derived at read time from expiresAt (see §2).

export const kycDocument = pgTable(
    "kyc_document",
    {
        id: text("id").primaryKey().$default(() => crypto.randomUUID()),

        // Polymorphic subject — no FK on purpose (five parent tables). Referential
        // integrity is enforced in the tRPC layer; the trade is the same one
        // activity_log makes deliberately.
        subjectType: text("subject_type").$type<KycSubjectType>().notNull(),
        subjectId: text("subject_id").notNull(),

        type: text("type").$type<KycDocType>().notNull(),

        // Multi-page document: one row per document, pages as an array —
        // keeps Conecta's proven Urls shape but adds file metadata.
        pages: jsonb("pages").$type<KycPage[]>().notNull(), // { url, size, mimeType }

        status: text("status").$type<KycDocStatus>().default("pending").notNull(),

        // Dates are `date`, not timestamp — documents expire on a calendar day.
        issuedAt: date("issued_at"),
        expiresAt: date("expires_at"),
        documentNumber: text("document_number"), // license no., NUIT digits, booklet plate…

        // Review trail
        reviewedBy: text("reviewed_by"),   // user.id snapshot, no FK (survives deletes)
        reviewedAt: timestamp("reviewed_at"),
        rejectionReason: text("rejection_reason"),

        // Resubmission chain: a new upload for the same (subject, type) inserts a
        // fresh row pointing at the one it replaces. Rows are never updated after
        // review — the chain IS the audit history.
        supersedesId: text("supersedes_id"),

        uploadedBy: text("uploaded_by").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        // Soft delete only (mirrors order_document)
        deletedAt: timestamp("deleted_at"),
        deletedBy: text("deleted_by"),
    },
    (t) => [
        index("kyc_document_subject_idx").on(t.subjectType, t.subjectId),
        index("kyc_document_status_idx").on(t.status),
        index("kyc_document_expiry_idx").on(t.expiresAt), // "expiring soon" queries
    ],
)
```

**Current document** for a `(subject, type)` = latest non-deleted, non-superseded row. Resubmission after rejection inserts a new `pending` row with `supersedesId`; the rejected row stays as history.

**Migration path:** the existing `kyc` jsonb slots and fleet doc columns have no data, so there is nothing to backfill. Keep the `kyc` table for `fiscalRegime` (or move that column onto `organization`) and stop writing the jsonb slots; drop them in a later cleanup script under `packages/db/scripts/`.

### Required-document matrix (config as code)

```ts
// apps/admin/src/lib/kyc/requirements.ts — pure module, shared client/server
type DocRequirement = {
    anyOf: KycDocType[]        // any one satisfies the slot
    expires: boolean           // must carry expiresAt to be approvable
    warnDays?: number          // pre-expiry warning window (default 30)
}

export const REQUIRED_DOCS: Record<KycSubjectKind, DocRequirement[]> = {
    shipper: [
        { anyOf: ["nuit"], expires: false },
        { anyOf: ["id-card"], expires: true },
        { anyOf: ["commercial-certificate"], expires: false },
    ],
    carrier: [
        { anyOf: ["nuit"], expires: false },
        { anyOf: ["id-card"], expires: true },
        { anyOf: ["commercial-certificate"], expires: false },
        { anyOf: ["alvara"], expires: true },
        { anyOf: ["bank-letter"], expires: false },
        { anyOf: ["republic-bulletin"], expires: false },
        { anyOf: ["commercial-exercise"], expires: false },
        // Hard eligibility gate — see §2 and §4:
        { anyOf: ["signed-contract"], expires: true },
    ],
    driver: [
        { anyOf: ["driver-license", "id-card"], expires: true }, // either satisfies
    ],
    truck: [
        { anyOf: ["vehicle-booklet"], expires: false },
        { anyOf: ["proof-of-ownership"], expires: false },
    ],
    trailer: [
        { anyOf: ["vehicle-booklet"], expires: false },
        { anyOf: ["proof-of-ownership"], expires: false },
    ],
}
```

The carrier "shipper docs + signed contract" rule and the driver "license OR id-card" rule both fall out of this table instead of being scattered through validation code.

---

## 2. Verification state machine

Two layers, mirroring how orders separate stored status from derived fields:

### 2a. Per-document status (stored)

`pending → approved | rejected`. Rejected documents are terminal rows; resubmission creates a new `pending` row. **`expired` is derived, never stored**: a document is expired when `status === "approved" && expiresAt < today`. No cron ever mutates document rows because of time passing — time-based state that is written becomes time-based state that drifts.

### 2b. Per-entity verification status (stored, but always recomputed)

Add a `kycStatus` text column (+ TS const, no pg enum) to `organization`, `driver`, `truck`, `trailer`, `link`:

```
KYC_STATUS = ["draft", "pending-review", "verified", "rejected", "expired", "suspended"]
```

| State | Meaning | Entered when |
|---|---|---|
| `draft` | Registered, required docs not all uploaded | entity created (default) |
| `pending-review` | Every required slot has a current `pending`-or-better doc | last required doc uploaded |
| `verified` | Every required slot `approved` and unexpired | reviewer approves final doc |
| `rejected` | ≥1 required doc rejected, awaiting resubmission | reviewer rejects |
| `expired` | Was verified; a required doc passed `expiresAt` | daily cron (see below) |
| `suspended` | Manual admin action, overrides everything | admin, with mandatory note |

The status is **stored for queryability** (list filters, order-form gating) but **owned by one pure function**, recomputed after every document mutation — the `deriveOrderFields` pattern:

```ts
// apps/admin/src/lib/kyc/derive.ts
export function deriveKycStatus(
    kind: KycSubjectKind,
    docs: CurrentDoc[],          // current doc per slot, with status + expiresAt
    opts: { suspended: boolean },
    today: string,               // injected, never Date.now() inside
): KycStatus
```

Transitions module `apps/admin/src/lib/kyc/transitions.ts` follows `orders/transitions.ts` exactly: pure, shared verbatim by server mutations and UI; the server re-guards every transition; manual transitions (`suspend`, `unsuspend`, force re-review) declare requirements (`note`, `manager`) the same way order transitions declare `["note","evidence","flag"]`.

### 2c. Expiration handling

- **Storage:** `issuedAt`/`expiresAt` as pg `date` columns on `kyc_document` (calendar days, timezone-free). Reviewer must enter `expiresAt` before approving any doc whose requirement has `expires: true` — enforced in the approve mutation, not just the UI.
- **Read time:** expiry is a comparison, so the truth is always current even if the cron lags.
- **Daily cron** (`/api/cron/kyc-expiry`, same auth pattern as `sheet-sync`/`tracking` crons):
  1. Flip entity `kycStatus` `verified → expired` where a required doc's `expiresAt` has passed (recompute via `deriveKycStatus`, don't hand-write SQL state logic).
  2. Emit "expiring soon" warnings at `warnDays` (default 30) and 7 days — surface as a dashboard stat + list-page filter (`?expiring=30d`), and later as notifications when Resend/WhatsApp templates land.
- **Carrier eligibility is a derived predicate, not a column:**
  ```ts
  isCarrierEligible = kycStatus === "verified"
      && currentDoc("signed-contract")?.status === "approved"
      && !isExpired(currentDoc("signed-contract"))
  ```
  A carrier with a missing/expired contract is **ineligible to operate** — enforced in `order.create`/`order.transition` server-side (§4), shown as a blocking banner in the order form.

---

## 3. Risk management — ownership verification & the High-Risk Subcontractor flag

### 3a. Ownership verification (per vehicle)

The `proof-of-ownership` document names the legal owner. During review the admin transcribes it, and the system compares against the carrier:

```ts
// added to truck, trailer, link (text + TS const):
ownershipStatus: text("ownership_status")
    .$type<"unverified" | "owner-verified" | "third-party">()
    .default("unverified").notNull(),
ownerName: text("owner_name"),   // as written on proof-of-ownership
ownerNuit: text("owner_nuit"),   // compared against organization.nuit
```

Review flow: admin opens the vehicle's `proof-of-ownership`, enters `ownerName`/`ownerNuit`. If `ownerNuit === carrier.nuit` → `owner-verified`. Otherwise the admin must explicitly choose `third-party` (with the mismatch shown side by side) — no silent auto-approval of a mismatch.

### 3b. The carrier risk flag (per organization)

Mirror the proven `flaggedForReview` quartet from `order`, plus a queryable level:

```ts
// added to organization:
riskLevel: text("risk_level").$type<"none" | "watch" | "high">().default("none").notNull(),
riskReason: text("risk_reason"),          // e.g. "HIGH_RISK_SUBCONTRACTOR: truck ABJ 123 MC owned by third party (NUIT 400…)"
riskFlaggedAt: timestamp("risk_flagged_at"),
riskFlaggedBy: text("risk_flagged_by"),   // user.id snapshot, no FK
```

- **Automatic:** the moment any of the carrier's vehicles is marked `third-party`, the reviewing mutation also sets the carrier to `riskLevel: "high"` with a machine-prefixed reason (`HIGH_RISK_SUBCONTRACTOR: …`) — in the same request, not a background job, so flag and cause can't drift apart. Clearing requires a manager and a note (logged via activity catalog).
- **Manual:** admins can flag `watch`/`high` for other reasons (incident history, payment disputes) with a free-text reason.
- Like the order flag: **not a status** — a flagged carrier keeps operating unless also `suspended`; the flag changes what booking demands.

### 3c. Operational enforcement (server-authoritative)

All enforcement lives in a pure module (`apps/admin/src/lib/kyc/eligibility.ts`) consumed by both the order procedures and the order-form UI — the transitions.ts contract: client renders, server decides.

| Condition | Order form (UI) | Server guard (`order.create` / `transition` past `booked`) |
|---|---|---|
| Carrier not `verified` / contract missing or expired | Blocking banner; carrier not selectable for booking | `FORBIDDEN: CARRIER_NOT_ELIGIBLE` |
| Carrier `riskLevel: "watch"` | Warning banner with reason | Allowed; order auto-flagged (`flaggedForReview` + `flagReason`) |
| Carrier `riskLevel: "high"` | Red banner; booking requires explicit acknowledgment + note | Requires `manager`+ role (uac gate) **and** a note; order auto-flagged for review; acknowledgment recorded in `order_history` metadata |
| Selected plate `ownershipStatus: "third-party"` | Inline warning badge in the plate picker (`searchVehicles` returns `ownershipStatus`) | Same as high-risk carrier: manager + note + auto-flag |
| Selected plate `unverified` | Amber "ownership not verified" badge | Warn-only initially; tighten to require-manager once the fleet backlog is reviewed |
| Driver/vehicle KYC not `verified` | Badge in pickers | Warn at `booked`; block at `to-loading` (cargo not yet committed → still swappable) |

This makes the loss-of-cargo scenario auditable end to end: the mismatch is on the vehicle row, the flag + reason on the carrier, the manager's acknowledgment note in `order_history`, and every action in `activity_log`.

---

## 4. Database & security architecture

### 4a. Schema summary (all changes)

| Table | Change |
|---|---|
| `kyc_document` | **New** — §1. Created via a script in `packages/db/scripts/` (no `ALTER TYPE` anywhere — all new vocabularies are text + TS const). |
| `organization` | + `kycStatus`, `riskLevel`, `riskReason`, `riskFlaggedAt`, `riskFlaggedBy`. Existing `status` stays as *account* lifecycle (`pending/active/closed`) — distinct from KYC. |
| `driver` | + `kycStatus`. Deprecate `driverLicense`/`passportCard` jsonb (empty; drop later). |
| `truck`, `trailer`, `link` | + `kycStatus`, `ownershipStatus`, `ownerName`, `ownerNuit`. Deprecate `booklet`/`license` jsonb. |
| `kyc` (existing) | Keep only as the home of `fiscalRegime` for now; jsonb slots frozen, dropped in a later cleanup. |

Relations to add in Drizzle: `kycDocument` has none (polymorphic, by design); add query helpers instead (`currentDocsFor(subjectType, subjectId)`).

### 4b. Secure file storage

Sensitive IDs/NUITs must not be publicly reachable. Plan:

1. **Dedicated protected bucket** `kycFiles` in `packages/edgestore/src/server.ts`, separate from `apploadFiles`:
   - Path: `[{ subjectType }, { subjectId }, { docType }]` — **IDs, never names/plates** (Conecta keyed on slugified names and plates; mutable and collision-prone — don't inherit).
   - `accept: ["application/pdf", "image/jpeg", "image/png"]`, `maxSize` ~5 MB.
   - `beforeUpload` / `beforeDelete`: staff only, resolved **live from the database** via the same `getStaffGates` the tRPC gate uses (not the session's cached copy), so a demotion cuts off access immediately.
   - EdgeStore **access control** on the bucket so files are served through the protected-file proxy — readable only when the request context carries `isStaff`.

   > ⚠️ **Read protection is not in place (open item).** Writes and deletes are staff-gated as described, but anyone holding a file URL can still read it. `.accessControl({ isStaff: { eq: "true" } })` is the one-line fix, and it is written into the code as a comment — but adding it today makes **every** EdgeStore request fail with a 500, which breaks order-document uploads too. Verified by A/B test: any `accessControl` rule, on any bucket, with any shape, 500s on this project, so the protected-files feature is not enabled on the account. **Decision needed:** enable protected files on the EdgeStore plan, or move `kycFiles` to storage that signs its own URLs (S3 presigned, R2). Until then, ID scans and NUIT certificates are URL-guessable-if-leaked, which is the one part of this design that is not yet true.
2. **Two-phase commit** (Conecta's proven pattern, and what `FileInput` already supports): upload with `temporary: true` → tRPC mutation inserts the `kyc_document` row → `confirmUpload` per page in `onSuccess`. Failed mutation → temp files expire on their own. Note: `documents-card.tsx` currently uploads permanent-by-default; KYC must use the temporary+confirm flow or files leak on failed submissions.
3. Never log document URLs in `activity_log` params (already a stated catalog rule).

### 4c. Authorization hardening (do this first)

- **Fix the open routers:** `fleet` and `organizations` routers currently use bare `protectedProcedure` — any authenticated `shipper`/`carrier`/`driver` account can register orgs and fleet. Move them to `authorizedProcedure`.
- **New uac statements** in `packages/auth/src/permissions/user.permissions.ts`:
  ```ts
  kyc: ["read", "list", "upload", "review", "override"],
  risk: ["read", "flag", "clear", "acknowledge-high"],
  ```
  Roles: `user` → read/list/upload; `manager` → + review (approve/reject), risk.flag, acknowledge-high; `admin` → everything incl. `kyc.override` (force re-review, unsuspend) and `risk.clear`. Same `isAuthorized` pure function drives both the tRPC gate and UI button states — no divergence possible.
- **New tRPC router** `backend/api/routers/kyc.ts` (cross-cutting, per the split convention): `listSubjects`, `subjectDetail`, `uploadDocument`, `review` (approve/reject with expiry entry + ownership transcription), `suspend`/`unsuspend`, `flagRisk`/`clearRisk`.
- **Activity catalog** entries for every mutation (`kyc.uploadDocument`, `kyc.review`, `kyc.flagRisk`, …) + `ActivityLog.*` messages in `en.json`/`pt.json`. Params whitelist: subject type/id, doc type, decision, risk level — never URLs, names on documents, or reasons verbatim.

---

## 5. Frontend — pages, responsiveness, Conecta heritage

### 5a. Navigation

Keep the existing management group (paths + pt aliases already exist), with fixes:

- Localize the hardcoded English labels (`"Shippers"`, `"Carriers"`, …) → `Admin.sidebar.content.management.*` keys in both locales.
- `/carriers/fleets` hosts **Trucks | Trailers | Links as tabs** on one page — no new nav entries.
- Add a **review-queue badge** on the group label: count of `pending-review` subjects (small tRPC count query, the sidebar's first data dependency — keep it one cheap grouped count).

### 5b. List pages — the responsive layout plan

Use the **orders pattern**, not a data table: the repo has no data-table abstraction, `table.tsx` is imported nowhere, and the card grid/list pattern is already proven responsive. Structure per page (parallel routes, as orders and Conecta both do):

```
app/[locale]/(protected)/(management)/shippers/{layout,@header,@stats,@data}
app/[locale]/(protected)/(management)/carriers/[tab]/…      (all | drivers | fleets)
frontend/pages/partners/…                                    (shared views/cards/sections)
```

- `@stats`: 3–4 `ResumeCard`s (Conecta pattern) — Total / Pending review / Verified / Expiring ≤30d — one grouped `count(*) filter(where …)` query.
- `@header`: debounced search + **status filter Tabs** (`all | draft | pending-review | verified | rejected | expired`) + risk filter + grid/list toggle. **URL is the state store** (search params drive the query key; server prefetch uses the same input builder → first page hydrates without refetch).
- `@data`: `useSuspenseInfiniteQuery` + `IntersectionObserver` sentinel; `useIsMobile()` forces grid view on small screens.

**Responsive strategy per breakpoint** (how dense data stays graceful):

| Breakpoint | Layout | What shows |
|---|---|---|
| Mobile (<640) | 1-col cards | Identity line (logo/avatar + name + **KYC StatusBadge**), one secondary line (NUIT / phone / carrier), doc-progress chip (`5/8 approved`), risk badge if flagged. Everything else lives in the detail sheet — tap anywhere opens it. |
| Tablet (sm–xl) | 2-col cards | + contact block, + expiry warning chip ("ID expires in 12d") |
| Desktop (xl+) | List rows, `grid-cols-12` | Identity (4) · contact/NUIT (3) · doc progress + expiry (2) · risk (1) · status (1) · actions (1). Row hover `border-card → border-primary`. |

Column plans per page:

- **Shippers**: logo+name, NUIT, email/phone, KYC status, doc progress, actions (Review docs · Open).
- **Carriers**: + **contract chip** (the eligibility gate — `Contract ✓ / missing / expired` rendered as its own badge, since it alone decides operability), + risk badge, + fleet/driver counts.
- **Drivers**: avatar (dicebear fallback, Conecta pattern), name, phone, carrier, license type used (license vs id-card), license expiry, assigned truck, KYC status.
- **Fleet** (tabs Trucks/Trailers/Links): plate (masked format), brand/model/year, carrier, **ownership badge** (`owner-verified` green / `unverified` amber / `third-party` red), booklet status, KYC status.

### 5c. The review surface

One shared **document review Sheet** per list page (the `UpdateOrderView` single-instance pattern): subject summary header → required-doc checklist (each slot: status badge, pages, uploaded date) → inline PDF/image preview (`<object>`/`<img>` from the signed URL — Conecta never built a viewer; this is table stakes for review) → per-document actions: **Approve** (with mandatory `expiresAt` + `documentNumber` when the requirement expires; ownership transcription fields for `proof-of-ownership`) / **Reject** (mandatory reason). Approve/reject buttons render from `isAuthorized(role, "kyc", ["review"])` — same function as the server gate.

Uploads by admins on behalf of partners reuse `FileInput mode="upload"` with `temporary: true` + confirm-on-success.

### 5d. StatusBadge extensions

Add `StatusKey`s + CSS var pairs in `packages/ui/src/styles/globals.css` (light+dark): `draft`, `pending-review`, `verified`, `rejected`, `expired`, `suspended`, `risk-watch`, `risk-high`, `owner-verified`, `third-party`, `unverified`.

### 5e. Conecta heritage — adopt / avoid

**Adopt** (with file references from the Conecta repo):

1. Parallel-route list pages (`@resume`/`@actions`/`@list`) — orders already does this; extend to the four new pages.
2. `ResumeCard` stat strip via single grouped `count(*) filter(...)` query.
3. **Two-phase EdgeStore commit + compensating rollback** (`create-organization-dialog.tsx`): temp upload → DB write → confirm; delete the org on downstream failure.
4. **Pre-submit uniqueness validation with per-field conflict errors** (`organization.validate` → `{hasNuit, hasEmail, hasPhone}` mapped onto fields) — already ported to this repo; keep it in any new registration forms.
5. **Wizard step in the URL** (`?step=`, `router.replace`) — deep-linkable, refresh-safe; use for the carrier registration flow (details → documents → contract).
6. **Empty-state trio** distinguishing "nothing yet" vs "nothing matched" (`empty-orders.tsx`), shape-matched skeletons, error fallback with reload.
7. **Radio-as-card selection** (`register-truck-form.tsx`) for truck type / subject kind pickers.
8. `ResponsiveDialog` (Drawer on mobile / Dialog / side Sheet) — this repo hand-rolls the fork per dialog; consolidate.
9. Localized zod schema factories `(t) => z.object(...)` with a `(k)=>k` static twin shared with tRPC — already the convention here; keep.
10. Dicebear avatar fallback for drivers.

**Do not inherit:** the `fiscalReginme` insert typo (silently drops the value), `commercialCertificate[0]` crash on empty array, `driver_card` column naming, the derived driver password `` `@Driver_${phone}` `` (this repo already uses `crypto.randomUUID()` — keep that; add invite/first-login OTP later), name/plate-derived storage owner keys, hardcoded `{0}` ratings, the unfinished fleet grid card stub.

---

## 6. Rollout order

1. **Security first** (no schema): move `fleet`/`organizations` routers to `authorizedProcedure`; add `kyc`/`risk` uac statements.
2. **Schema**: `kyc_document` + new columns via `packages/db/scripts/` script (no enums, additive only — safe on the shared DB).
3. **Pure modules**: `lib/kyc/requirements.ts`, `derive.ts`, `transitions.ts`, `eligibility.ts` (fully unit-testable, no I/O).
4. **kyc router** + EdgeStore `kycFiles` protected bucket + activity catalog + i18n messages (both locales, incl. sidebar labels).
5. **List pages** (shippers → carriers → drivers → fleet) + review Sheet + StatusBadge keys.
6. **Order-form enforcement**: eligibility banners, plate ownership badges, manager acknowledgment flow, server guards.
7. **Cron**: `/api/cron/kyc-expiry` + dashboard expiring-soon stats. Notifications ride on the pending Resend/WhatsApp setup.
