# Contracts module + Trust wall — phased implementation plan

## Context

Two pieces of work for Appload Enterprise (apps/app portal, packages/db, packages/domain):

- **Contracts**: a transporter asked for "one order sent to several transporters", priced by trips, weight or days, with rental. Design in memory `contracts-module-plan`: a `contract` is a parent that trips draw down from through per-carrier `contract_allocation` rows; **every trip stays a `movement`**, fulfilment is derived by summing linked rows, never a stored counter.
- **Trust wall**: a carrier objected that Appload brokers loads AND can read their client list and prices. Today separation is app code only: one Postgres, the admin connects as the table owner, no RLS. Design in memory `trust-wall-plan`.

Settled with Claire on 2026-09-30 (AskUserQuestion):

| Question | Decision |
|---|---|
| Order of work | **Both, wall as phase 0**: RLS + staff-role tests first, then contracts P1 this week; grants, access log, data page after contracts P1 |
| "Same order to several transporters" | **Split** one contract's committed quantity across carriers via allocations. Broadcast stays the existing RFQ |
| Contract price | **Editable default** prefilled on each trip, never a ceiling |
| Rental direction / currency | **Both directions** through the same sell/buy halves. **One currency per contract**, converted through `fx_daily_rate` for the money strip |

Verified facts the plan leans on (from this session's exploration):

- `movement` has three org columns: `organization_id` (whose books), `client_org_id` (sell half), `carrier_org_id` (buy half); children (`movement_cost/_document/_event/_request/_location/_route/_tracking_*`/`_dispute(_row)`) reach the tenant only through `movement_id`. `movement_own_fleet_ck` forbids a buy side on own-fleet rows.
- Appload org id is the constant `'appload'` (`packages/db/src/types/index.ts:124`), `organization.type='appload'`, never has members. Admin writes movements only via `packages/domain/src/appload/link.ts` and always with `'appload'` as client or carrier.
- No admin screen reads any `movement*` table, `partner_connection` or `thread` for movements (`threads/access.ts:148` gives staff `false` on movement subjects).
- DB client: one postgres-js singleton, `prepare:false`, Supabase **transaction pooler 6543**, connects as `postgres.<ref>` = table owner (Supabase's `postgres` role carries `bypassrls`, so RLS never applies to it). Only `DATABASE_URL` exists. tRPC injects `db` once at `packages/trpc/src/init.ts:48`.
- Drizzle `drizzle-orm 0.45.2` / `drizzle-kit 0.31.10` → `pgPolicy` / `pgRole().existing()` in schema are supported, so policies ride `db:push` (dev) and `db:generate` → `db:migrate` (prod) like tables.
- Latest migration is `0025_plate_fks_cascade` (on stage/31-supabase; 0024 is the last one on dev). Journal: `packages/db/drizzle/meta/_journal.json`. Each new migration gets a bullet in `RELEASE.md`.
- Enum convention: `text(col, { enum: CONST })`, never `pgEnum` (no `ALTER TYPE` on the shared DB). Ids `text` uuid, money `numeric(14,2)` + currency column + CHECK, `version` int for optimistic lock.
- jsonb columns are typed with `$type<T>()`; the zod schemas that back them live in `packages/db/src/types/index.ts`.
- Portal feature layout: `apps/app/src/frontend/pages/<feature>/{server/procedures.ts, server/projection.ts, server/activity.ts, types/index.ts, sections/, views/, hooks/}`; zod inputs in `apps/app/src/backend/schemas/<feature>.ts`; messages `apps/app/src/messages/{en,pt}/<feature>.json` mounted in `messages/index.ts`; routes in `apps/app/src/i18n/routing.ts` `pathnames`; nav in `frontend/components/navigation/sidenav.tsx`; resources in `packages/auth/src/permissions/org.permissions.ts`.
- Harness pattern: `apps/app/scripts/verify-movements.ts` (`contextFor`, `check`, `expectError`, trackers + `purge`), run with `NODE_OPTIONS=--conditions=react-server pnpm dlx tsx <abs path>`. Seed: `apps/app/scripts/seed-demo.ts` (manifest, `--reset`, `hushTracking`).
- Weight units are `ton | kg | liter`. Reference kinds are `REQ | ORD` on `organization_counter`.
- Known bug: `recordRequestActivity` stamps `organization_id` from the cookie's `activeOrganizationId` (`packages/trpc/src/activity-log.ts:68`), which the tenant gate says never to trust and which is often null.

Also settled: deck slide 10 (distance covered vs remaining, ETA from average speed, falling-behind alerts) was not in the original scope; Claire chose to add it as **Phase P after C2**.

Out of scope for this plan: the module registry itself (nothing here needs it), per-km pricing (Phase P caches the route at dispatch, which is its prerequisite; the price variant itself comes later), contract-level RFQ (outlined as C3, not detailed), admin UI for contracts, admin order-page progress bar, map pin colours by on-time/late (slide 11), GPS.

---

## Phase 0 — Trust wall core: roles, RLS, proof (≈2 d) — FIRST

Goal: a staff DB session cannot read a tenant's portal rows unless the Appload org is a party on the row. Proven by a harness that runs as the staff role and gets zero rows.

### 0.1 Roles (one script, not a migration — passwords)

`packages/db/scripts/create-db-roles.mjs` (uses `connect` from `sql.mjs`, `--yes` gate, prints what it would do). Roles are cluster-wide on the Supabase project; **grants are per database**, so the script runs once against `appload-dev` and once against `appload-prod`:

```sql
create role appload_staff   login password :staff_pw   nobypassrls noinherit;
create role appload_service login password :service_pw nobypassrls noinherit;

-- staff: may touch every table; RLS is the wall, not grants
grant usage on schema public to appload_staff;
grant all on all tables in schema public to appload_staff;
grant usage, select on all sequences in schema public to appload_staff;
alter default privileges for role postgres in schema public grant all on tables to appload_staff;
alter default privileges for role postgres in schema public grant usage, select on sequences to appload_staff;

-- service: only what the Infobip webhook and the admin crons touch
grant usage on schema public to appload_service;
grant select, insert, update on chat_conversation, chat_message, tracking_request,
  "order", order_location, order_document, order_history, sheet_sync,
  movement, movement_tracking_request, movement_location, movement_route,
  kyc_document, organization, driver, truck, trailer, link, notification, member, "user"
  to appload_service;
grant usage, select on all sequences in schema public to appload_service;
```

(The exact service table list is taken from the crons/webhook table map below; anything not listed is `permission denied`, which is the point.)

Pooler usernames are `appload_staff.<ref>` / `appload_service.<ref>` on `aws-1-eu-west-1.pooler.supabase.com:6543`.

### 0.2 Schema: policies in Drizzle (migration `0026_trust_wall`)

New file `packages/db/src/schemas/rls.ts`:

```ts
export const staffRole = pgRole("appload_staff").existing();
export const serviceRole = pgRole("appload_service").existing();
export const APPLOAD = sql`'appload'`;
```

Add a `pgPolicy(...)` entry to the third argument of each tenant table below (this also enables RLS on the table; drizzle emits `alter table … enable row level security` + `create policy`). Owner (`postgres`) is unaffected; portal keeps its app-code tenancy.

| Table | `appload_staff` policy (`for all`, `using` = `with check`) | `appload_service` |
|---|---|---|
| `movement` | `client_org_id = 'appload' or carrier_org_id = 'appload'` (+ grant clause in T2) | `using (true)` |
| `movement_request`, `movement_cost`, `movement_document`, `movement_event`, `movement_location`, `movement_route`, `movement_tracking_request`, `movement_tracking_alert`, `movement_dispute`, `movement_dispute_row` | `exists (select 1 from movement m where m.id = <table>.movement_id)` — the subquery runs as the staff role, so the movement policy cascades; no security-definer helper needed, no recursion (children never reference each other) | `movement_tracking_request`, `movement_location`, `movement_route`: `using (true)`; others: no policy (and no grant) |
| `partner_connection` | `requester_org_id = 'appload' or target_org_id = 'appload'` (Appload has no connection rows → staff sees none; that IS the client list) | none |
| `thread` | `subject_type = 'order'` | none |
| `thread_participant`, `thread_message`, `thread_read` | `exists (select 1 from thread t where t.id = <table>.thread_id)` | none |

Deliberately **not** behind RLS (say so on the data page in T4): `order*` (Appload is always a party), `organization`, `member`, fleet + `kyc_document` (verification is the service), `organization_counter`, `subscription_usage`, `notification` (event pings; RLS on it would break `insert … returning` from admin's `notify`), `activity_log`, auth tables.

Indexes already exist on every column the policies filter (`movement` client/carrier org indexes, children `movement_id` indexes, `thread_subject_uidx`). Verify `thread_participant/thread_message/thread_read` have a `thread_id` index; add if missing in the same migration.

Migration: `pnpm --filter @workspace/db db:generate` → rename to `0026_trust_wall.sql`, review (expect only `enable row level security` + `create policy`), bullet in `RELEASE.md`. Dev: `create-db-roles.mjs --yes` **then** `db:push` (policies name the roles).

### 0.3 Code: two connection strings, one new export

- `packages/db/src/db.ts`: add `serviceDb` built from `SERVICE_DATABASE_URL ?? DATABASE_URL` (same lazy Proxy pattern). No other code change to the singleton.
- Admin process switches to `serviceDb` in: `apps/admin/src/app/api/chats/infobip/route.ts` (and everything it calls: `resolveOrderForConversation`, `resolveMovementForConversation`, `recordMovementLocation`, `respondMovementRequests`, `reportMovementDelivery` — all take `db` as a parameter already), `apps/admin/src/app/api/cron/{tracking,sheet-sync,kyc-expiry}/route.ts` and `lib/tracking/run-slot.ts`. Portal crons (`apps/app/api/cron/*`) stay on the owner `db`.
- Env layout (one source per role): `packages/db/.env` = owner (drizzle-kit + `packages/db/scripts/*.mjs`, change `databaseUrl()` fallback in those scripts from `apps/admin/.env` to `packages/db/.env`); `apps/app/.env` = owner; `apps/admin/.env` = `DATABASE_URL=<staff>` + `SERVICE_DATABASE_URL=<service>`. Harness/seed scripts in `apps/app/scripts` change their one fallback line from `../admin/.env` to `.env` and read `STAFF_DATABASE_URL` from `../admin/.env`. `.env.example` ×3 updated ("Neon" headers go too).
- `RELEASE.md` ~line 363 ("admin and portal DATABASE_URL byte-for-byte identical"): rewrite to "same database, different roles".

### 0.4 Proof: `apps/app/scripts/verify-trust-wall.ts`

Opens two clients: owner `db` and `staffDb = drizzle(postgres(STAFF_DATABASE_URL, { prepare:false }))`, plus `serviceDb`. Fixtures written as owner for tenant B (from `portal-test-accounts`), cleaned up in `finally`. Checks (each a `check(...)` line, N/N summary, exit 1 on failure):

1. Staff `select count(*) from movement where id = X` → 0 for a B-only movement; → 1 when `carrier_org_id='appload'`.
2. Staff select on `movement_cost`, `movement_request`, `movement_document` for X → 0 rows each; owner sees them.
3. Staff select on `partner_connection` → 0 rows total; `thread` for a movement subject → 0; for an order subject → ≥1.
4. Staff `insert into movement (... organization_id=B, carrier_org_id=B ...)` → policy violation error; with `carrier_org_id='appload'` → succeeds (link.ts path stays alive).
5. Admin tRPC caller (`apps/admin/src/backend/api/routers/threads.ts`) with `ctx.db = staffDb` on a movement thread → `NOT_FOUND`; order thread → ok.
6. Service role: `select` on `movement` returns the row (cross-tenant routing works); `select` on `movement_cost` → `permission denied`.
7. `staffDb` on auth tables (`select from "user" limit 1`) → ok (Better Auth in admin still works).

Also re-run `verify-appload-partner.ts` with admin callers pointed at `staffDb` (one-line env switch) to prove the Appload-link flows survive RLS.

### 0.5 Prod steps (phase 0)

1. `create-db-roles.mjs --yes` against `appload-prod` with new passwords (Claire runs; classifier refuses prod for me).
2. `DATABASE_URL=<prod owner> pnpm --filter @workspace/db db:migrate` (0026).
3. Vercel admin project: `DATABASE_URL` → staff URL, add `SERVICE_DATABASE_URL`. Portal + website unchanged.
4. Smoke: admin sign-in, one order transition, Infobip webhook test ping, `kyc-expiry` cron manual trigger.
5. Rollback = point admin `DATABASE_URL` back at the owner URL; policies are inert for the owner.

---

## Phase C1 — Contracts, demoable on its own (≈2 d)

Goal: a tenant files a contract, splits it across carriers (or its own fleet) with a price model each, and files trips under an allocation with the price prefilled. Contract page shows terms, allocations, derived fulfilment and the linked trips.

### C1.1 Schema (migration `0027_contracts`)

`packages/db/src/schemas/contracts.ts` (own package export `@workspace/db/contracts`, import siblings directly, never the barrel):

```ts
export const CONTRACT_BASIS  = ["trips", "weight", "days"] as const;   // days = rental
export const CONTRACT_STATUS = ["draft", "active", "closed"] as const; // exhausted/expired are DERIVED

contract:
  id text pk uuid; seq serial unique
  organization_id text notNull FK organization            // whose books
  reference text                                            // "CON-0001-26" via organization_counter kind "CON"
  status text enum CONTRACT_STATUS default 'draft'
  basis text enum CONTRACT_BASIS notNull
  client_org_id text FK organization; client_name text; client_reference text   // sell half (nullable, mirrors movement)
  origin jsonb $type<Location>; destination jsonb $type<Location>              // both null = any lane
  starts_on date(mode string) notNull; ends_on date(mode string) notNull
  committed_qty numeric(12,3) notNull                       // trips | tons | days, by basis
  currency currencyEnum notNull; fiscal_regime fiscalRegimeEnum
  sell_price jsonb $type<PriceModel>                        // what the client pays the owner; null when no sell half
  file_url text; file_name text                             // the signed contract (edgestore), one file
  notes text; version int default 1; created_by FK user; created_at; updated_at
  idx (organization_id, status); idx (client_org_id); unique (organization_id, reference)
  check committed_qty > 0; check ends_on >= starts_on; check (client_org_id is null or client_org_id <> organization_id)

contract_allocation:
  id text pk uuid
  contract_id text notNull FK contract on delete cascade
  carrier_org_id text FK organization                       // null = owner's own fleet
  carrier_name text                                         // typed off-platform carrier
  share_qty numeric(12,3) notNull                           // same unit as contract.basis
  buy_price jsonb $type<PriceModel>                         // what the owner pays this carrier; null on own-fleet
  truck_id text FK truck set null; driver_id text FK driver set null; truck_plate text   // rental pins
  notes text; created_at; updated_at
  unique (contract_id, carrier_org_id) where carrier_org_id is not null
  partial unique (contract_id) where carrier_org_id is null   // one own-fleet allocation per contract
  idx (carrier_org_id); idx (truck_id) where truck_id is not null
  check share_qty > 0; check (carrier_org_id is not null or buy_price is null)

movement: + contract_allocation_id text FK contract_allocation on delete set null, idx
order:    + contract_allocation_id text FK contract_allocation on delete set null   // filled by link.ts when a tenant's contract trip is brokered by Appload
```

`REFERENCE_KIND` gains `"CON"` (`packages/db/src/types/index.ts:134`); `nextReference` in `packages/domain/src/movements/reference.ts` (or wherever it lives) is reused as is.

**RLS for the new tables** (same migration, AS BUILT): staff policy on `contract` = `organization_id = 'appload' or client_org_id = 'appload'`; on `contract_allocation` = `carrier_org_id = 'appload' or exists (select 1 from contract c where c.id = contract_id)`. No security-definer helper: the contract policy never looks at allocations, so there is no recursion and plain Drizzle policies suffice. Consequence: staff do not see a tenant's contract merely because one share names Appload; they see that share, and the Appload orders under it. Grant clause added in T2.

**Claire's notes from the first browser pass (2026-09-30), built or queued:** (1) a contract or a share may be **open-ended** (`committed_qty` / `share_qty` null, migration 0028): nobody knows the tonnage beforehand, trips keep being filed while there is cargo, and it is never "used up" — BUILT. (2) Rental contracts normally have no lane (trucks work on a mine or do many short trips a day): the lane is already optional; C2 defaults a rental to any-lane and shows the truck on rental from the contract alone, with no trips needed. (3) **Rental monitoring is different** from a lane's: no off-route or short-distance judgement; a daily presence check-in instead — C2 design point, shape to confirm with Claire. (4) "It should also be on the orders": to clarify with Claire what she means (the loads list already carries contract trips and slices by `?contract=`, and the load sheet offers the contract picker wherever it opens).

**Simplification agreed with Claire (2026-09-30 evening), BUILT:** Contratos moved under Operações beside Pedidos (a contract is many orders at once); the Cotações menu is retired — a standing quote is an open-ended contract (lane, validity, per-trip price, no quantity) and the client accepts it. A draft naming a portal client is a **proposal**: the client activates (accepts) or closes (declines), the owner cannot accept for it (`CLIENT_MUST_ACCEPT`), both sides get `contract.proposed/accepted/declined` notifications. Old `quote` rows carry over via `migrate-quotes-to-contracts.mjs` (0029 `legacy_quote_id`); `/quotes` redirects through it. The quotes feature code (router, views) is still in the tree, unreachable except `sections/badges.tsx` which the contracts list reuses — cleanup owed. Claire's framing "even a trip is a contract" is kept at the surface (same door, same language), not as a contract row per trip.

**Built with two deviations from the sketch above:** a typed off-portal carrier is a share like a portal one (it carries a buy price; the own-fleet share is the one with neither carrier nor name), and a carrier tenant may file an own-fleet trip by hand when it is under a client's share naming it (the contract is the standing order; `OWN_TRIPS_COME_FROM_CLIENTS` is waived only then).

**Price model** — zod union in `packages/db/src/types/index.ts` beside `AddressSchema`, `PriceModel = z.infer<>`:

```ts
PriceModelSchema = z.discriminatedUnion("model", [
  { model: "per-trip", rate: money },                                   // rate × 1
  { model: "per-ton",  rate: money, minBillableTons: money.optional() }, // rate × max(weight in tons, min)
  { model: "per-day",  rate: money, billableDays: z.enum(["calendar","working"]) },  // rental: rate × days elapsed; money on the contract
  { model: "lump-sum", total: money },                                  // trips priced 0
])
```
Per-km is intentionally absent (add a variant later = no migration). Standby rate skipped; add when a rental needs it.

### C1.2 Domain (`packages/domain/src/contracts/`, export `./contracts/*`)

- `price.ts` — pure: `tripPrice(model, { weight, weightUnit }): number | null` (per-trip → rate; per-ton → rate × max(tons, min); lump-sum → 0; per-day → `null`, money is not on the trip). `toTons(weight, unit)` (kg/1000, liter → null). `billableDays(from, to, mode)` (working = Mon–Sat, Maputo calendar, matches the crons' week).
- `progress.ts` — `contractProgress(db, contractId)`: one grouped query over `movement where contract_allocation_id in (allocations) and status <> 'cancelled'` → per allocation `{ consumed, delivered }` (trips: count; weight: sum tons; days: `billableDays(starts_on, min(today, ends_on))` — rental consumption is elapsed time, not trips). Returns `remaining = share - consumed` and contract totals. **This is the only source of fulfilment; nothing is stored.**
- `state.ts` — `derivedState(contract, progress, today)`: `draft | active | exhausted | expired | closed` for display and for the "can file a trip" rule (draft/closed → no; exhausted/expired → yes but flagged).
- `access.ts` — `visibleContracts(tenantId)` predicate: `organization_id = tenant or client_org_id = tenant or exists allocation.carrier_org_id = tenant`; `roleOn(contract, allocations, tenantId)` → `owner | client | carrier`. A carrier sees only its own allocation and no other carrier's price (projection strips them).
- `apply.ts` — `createContract`, `updateContract` (version lock), `transitionContract` (draft→active, active→closed), `addAllocation/updateAllocation/removeAllocation` (remove refused when trips are linked: `ALLOCATION_HAS_TRIPS`). Rig checks: `truck_id`/`driver_id` must belong to `carrier_org_id ?? organization_id` (reuse `resolveRig` logic from the movements router by lifting its ownership query into domain).
- `prefill.ts` — `tripDefaultsFor(db, tenantId, allocationId, { weight, weightUnit })` → `{ execution, clientOrgId, clientName, clientReference, carrierOrgId, carrierName, truckId, driverId, truckPlate, sell, buy, origin, destination, currency }` from the contract halves; used by the server as the fallback when the input leaves a leg empty, and by `contracts.tripDefaults` for the UI. Owner filing under a carrier allocation → `execution: "partner"`, buy from `buy_price`, sell from `sell_price` if a client half exists. Owner filing under own-fleet allocation → `execution: "own-fleet"`, sell only. **Carrier** filing under an allocation naming it → `execution: "own-fleet"`, sell = its `buy_price` (what it will be paid), client = contract owner.

### C1.3 tRPC (`apps/app/src/frontend/pages/contracts/server/procedures.ts`, registered in `_app.ts` + activity catalog `server/activity.ts` with `entityType: "contract"`)

`contracts` router, all `tenantProcedure` + `assertCan(role, "contract", action)` after the row loads (resource `contract: ["create","read","update","list"]` added to `org.permissions.ts` for owner/admin; member gets `read, list`):

- `list({ status?, role?, q? })` → rows through `visibleContracts`, with `derivedState` and progress totals (one `contractProgress` batch).
- `get({ id })` → `ContractDetail`: terms, `roleOn`, allocations (stripped for carriers), progress per allocation, linked trips summary (`movement` id/reference/status/date/weight/leg total, via `loadVisible` rules), permissions.
- `create(CreateContractSchema)`, `update`, `transition({ id, to, expectedVersion })`.
- `allocations.add / update / remove`.
- `formOptions` → reuse the movements `formOptions` query body (lift into a shared `partnerOptions(db, tenantId)` in `movements/server/projection.ts`, both routers call it).
- `tripDefaults({ allocationId, weight?, weightUnit? })` → `prefill.ts`.
- `setFile({ id, url, name })` after edgestore upload (path helper `contractFilePath` in `@workspace/edgestore/path`).

Changes in `movements/server/procedures.ts`:
- `CreateMovementBaseSchema` + `UpdateMovementBaseSchema` (`backend/schemas/movement.ts`) gain `contractAllocationId: z.string().nullable().optional()`; `FIELD_GROUP` gets it so it is editable.
- `create`: when set → load allocation through `visibleContracts`; `derivedState` draft/closed → `CONTRACT_NOT_OPEN`; merge `tripDefaultsFor` under the input (input wins: editable default); stamp `contractAllocationId`. New `movementFlags` reason codes `CONTRACT_LANE_MISMATCH` (contract has a lane and origin/destination place ids differ) and `CONTRACT_OVER_COMMITTED` (remaining ≤ 0) — **flags never block** (translated in `flag-reason.ts`).
- `formOptions` also returns `allocations: { id, contractReference, contractId, basis, counterparty, remaining, currency }[]` = open allocations the tenant may file under (owner's, plus those naming it as carrier).
- `get`/`detailOf` adds `contract: { id, reference, allocationId, basis, remaining, model } | null`.
- `list` input gains `contractId?` (drives the per-contract trips list and CSV export = the cheap "por contrato" group-by).
- `packages/domain/src/appload/link.ts`: the three `insert(movement)` and the order insert copy `contractAllocationId` from the source movement (one field each).

### C1.4 UI

Routes (`routing.ts`): `/contracts` → pt `/contratos`; `/contracts/[contractId]` → pt `/contratos/[contractId]`. Route group `(protected)/contracts/` copies the `quotes/` layout (slots `@header/@stats/@data`, each with `loading.tsx`) and `[contractId]/page.tsx` + `loading.tsx` like `orders/load/[loadId]`.

- Sidenav: `company` array gets `{ Icon: IconFileText, name: t("company.contracts"), match: "/contracts", path: "/contracts" }` right after quotes.
- `contracts/views/contracts-data-view.tsx` on the list kit (TanStack table like fleet): reference, counterparty, basis, period, committed/consumed bar, state badge, currency. Row → detail. `?tab=own|partners` mirrors orders (owner-side vs contracts naming me as carrier).
- `contracts/sections/contract-sheet.tsx` (create/edit; shorter `LoadSheet` sibling): basis radiogroup, lane (reuse the load sheet's place inputs), period, committed qty with unit by basis, currency + fiscal regime, client half (carrier tenants; same `NONE/TYPED` sentinels), sell price model fields (`PriceModelFields` component, one per variant), file upload.
- `contracts/views/contract-detail-view.tsx`: `LoadHeader`-style header (reference, state badge, actions activate/close/edit) + `TermsCard` (parties-card template), `AllocationsCard` (rows per carrier: share, buy price model, consumed/remaining progress, "File a trip" button → opens `useNewLoad().open(execution, { contractAllocationId })`), `TripsCard` (movements list rows filtered `contractId`, link to `/orders/load/[loadId]`), `FileCard`.
- Load sheet (`movements/sections/load-sheet.tsx`): `SelectInput name="contractAllocationId"` after the shape radiogroup (options from `formOptions.allocations`); on change call `contracts.tripDefaults` and `setValue` the halves, rig and lane where the form is still empty. `defaultsFor` accepts the preselected allocation.
- Movement detail: `ContractCard` (parties-card template) under `RouteCard`, gated on `load.contract`, links to the contract.

### C1.5 i18n

`apps/app/src/messages/{en,pt}/contracts.json` mounted as `App.contracts` (`messages/index.ts`, one import + one mount line per locale; pt is the typed source). Namespaces: `App.contracts.{list, form, detail, allocations, price-models, states, errors}`; `App.shell.sidebar.company.contracts` in `en.json`/`pt.json`; `App.loads.form.contract.*` (picker label, "prefilled from contract" hint); flag reasons `CONTRACT_LANE_MISMATCH`, `CONTRACT_OVER_COMMITTED` in the flag-reason namespace; error codes `CONTRACT_NOT_OPEN`, `ALLOCATION_HAS_TRIPS`, `ALLOCATION_NOT_VISIBLE`, `RIG_NOT_ON_ALLOCATION`. Restart the dev server after editing messages.

### C1.6 Harness `apps/app/scripts/verify-contracts.ts` (copy the verify-movements skeleton; tracker `contractsHere`; purge order movements → allocations → contracts → counters year)

- pure: `tripPrice` per variant incl. per-ton min billable, kg→ton, lump-sum 0, per-day null; `billableDays` calendar vs working across a Sunday.
- A (shipper) creates a per-ton contract 1 000 t, allocations B 600 t + typed carrier 400 t; `list` as A shows it, as B shows only B's allocation without the other price, as C → `NOT_FOUND`/empty.
- Draft → filing a trip refused `CONTRACT_NOT_OPEN`; activate; A files 300 t under B's allocation → `buyTotal = 300 × rate`, `contractAllocationId` set, `progress.consumed = 300`, remaining 300; A overrides the price on a second trip → stored as typed (editable default); cancel the first → consumed drops (derived, not counted).
- 3 trips totalling 700 t → last one carries `CONTRACT_OVER_COMMITTED` flag and still saves; lane mismatch flags, saves.
- B (carrier) files an own-fleet trip under A's allocation naming it → `execution own-fleet`, sell leg = B's buy price, `clientOrgId = A`.
- B creates a carrier-owned contract with sell price and an own-fleet allocation; files a trip → sell prefilled, no buy (own-fleet CHECK holds).
- `allocations.remove` with trips → `ALLOCATION_HAS_TRIPS`; close contract → `list` state `closed`; `movements.list({ contractId })` returns exactly the linked trips.
- Trip under an allocation with `carrier_org_id='appload'` → linked order carries `contract_allocation_id` (link.ts path).
- Re-run `verify-movements.ts` (no regression; `formOptions` shape grew).

### C1.7 Seed-demo additions

`contracts()` step after `portalLoads()`: (1) CTP → A.S.M. per-ton contract Maputo→Beira, 2 000 t, allocation A.S.M. 1 200 t + typed "Transportes Lalgy" 800 t, two trips filed (one delivered, one on-route → goes through `made.movements` so `hushTracking` covers it); (2) A.S.M.-owned per-trip contract with a typed client and an own-fleet allocation, one closed trip. Manifest gains `contracts: string[]`; `reset()` deletes allocations → contracts after movements.

### C1.8 Prod steps (C1)

`db:migrate` (0027), RELEASE.md bullet, release the portal branch as usual. No env changes. Dev got 0027 via `db:push` after 0026.

---

## Phase C2 — Rental, fleet, FX strip, per-contract slices (≈1 d)

No migration expected (rental fields shipped in C1).

- **Rental money**: `contracts.get` for `basis = 'days'` returns `accrued = rate × billableDays(starts_on, min(today, ends_on), mode)` per half (sell on contract, buy per allocation) and `projected = rate × billableDays(starts_on, ends_on)`; trips under a rental are created with `sell/buy = null` (prefill returns null legs; `tripPrice` per-day → null) and marked "tracking only" on the ContractCard.
- **Fleet**: `fleet.vehicles.list/get` left-join active rental allocation (`truck_id = truck.id`, contract `status='active'`, `basis='days'`, `ends_on >= today`) → `rentalUntil`, `rentalWith`; `RentalBadge` in `fleet/sections/badges.tsx` shown in `vehicle-profile-sheet.tsx` header + Operation card and the state column. Fleet `status` column stays untouched (it is never written today; rental state is derived, consistent with the fulfilment rule).
- **Money strip on `/contracts`**: `contracts.stats` → per currency `{ committedValue, consumedValue, remainingValue }` (freight: qty × rate or lump-sum total; rental: projected/accrued) rendered with the existing `MoneyStrip` (`packages/ui/src/customs/list/money-strip.tsx`) one line per currency **plus one converted total in MZN** at the latest `fx_daily_rate` row (domain `latestRates(db)` + `toMzn(currency, amount, rates)` in `packages/domain/src/contracts/fx.ts`; `ensureDailyRates` tops the table up first). Assumption to state on the strip: "≈ at today's rate". Per-trip loading-day conversion (KPI rule) is not applied here.
- **Slices**: analytics `loads` report and the movements CSV export accept `contractId` (already on `list` input from C1); contract detail's TripsCard "Export CSV" passes it. That is the "por contrato / por projecto" reporting from deck slides 14/17.
- Harness additions in `verify-contracts.ts`: rental accrued after N days (freeze `today`), truck shows `rentalUntil` while active and not after close; strip converted total equals sum(lines × rate); rental trip has null legs.
- Seed: one rental contract A.S.M. truck → CTP for 30 days (own-fleet allocation pinning `RIG.truck`), so the fleet page shows "on rental until".
- i18n: `App.contracts.rental.*`, `App.fleet.rental-until`, strip labels.

> **AS BUILT (2026-10-01, commit 737f32b):** the money strip and the CSV slice only; rental accrual, fleet `rentalUntil` and the rental seed are **parked** with the rest of the rental work. Strip: `contracts.stats.money` = per currency `{ committed, drawn, remaining }` from the reader's side (client pays the sell price, carrier is paid its share, owner earns the sell price when there is one and pays its shares otherwise; an owner that sells *and* subcontracts reads revenue only — `ponytail:` in `procedures.ts`), closed contracts excluded, open commitments count drawn only; converted line "≈ MZN" at the newest `fx_daily_rate` row (`packages/domain/src/contracts/fx.ts` `latestRate` + `toMzn`, `ensureDailyRates` first) shown only when there is more than one currency or the one is not MZN. `consumedValue` beside `commitmentValue` in `price.ts` (lump sum pro-rated). Slice: `movements.export` honours `contractId` (the list already did), TripsCard "Exportar CSV" calls it through `movementsListInput("all", …)`. Harness 53/53. Browser: strip seen on /contratos as Cliente Teste; export button present, download not clicked.

---

## Phase P — Progress, ETA, falling-behind (deck slide 10) (≈2 d, after C2)

Added 2026-09-30 at Claire's request. Today: `movement_route` caches distance, duration and polyline **only when somebody opens the load page** (`movements.route`, `procedures.ts:2265`) or when Appload links the load; pings land in `movement_location`; the slot review (`packages/domain/src/tracking/movement-review.ts`) already judges `no-location | picked-address | off-route | short-distance`. Nothing shows km covered/remaining or an ETA. **No migration**: everything is derived from the cached route and the latest ping; the new alert issue is a text enum value.

### P.1 Route cached at dispatch (the shared fix)
- Lift the compute-and-cache body of `movements.route` into `packages/domain/src/tracking/route-cache.ts` → `ensureMovementRoute(db, row): Promise<MovementRoute | null>` (same freshness rules, same failure memo, `computeRoute` from `@workspace/maps/server/routes`; domain already depends on `@workspace/maps`). `movements.route` calls it; behaviour unchanged.
- `transitionMovement` (`packages/domain/src/movements/apply.ts:222`) calls it after a successful move to `on-route`, awaited, failure swallowed: a lane Google cannot resolve never blocks dispatch (flags-never-block). One Routes call per dispatched load, the same call the page would have bought. Remove the `ponytail:` note at `movement-review.ts:290`.
- Unlocks later: `per-km` price model (rate × `distance_meters` at dispatch) and off-route coverage for loads nobody opened.

### P.2 Domain `packages/domain/src/tracking/progress.ts` (pure)
`movementProgress({ route, latest, startedAt, expectedDeliveryAt, now })`:
- With a `routes` polyline: `projectOntoPath` (`packages/maps/src/lib/geometry.ts:161`, returns `along`) → `coveredMeters = along`, `remainingMeters = distanceMeters − along`, `offRoute = distance > OFF_ROUTE_METERS`.
- Without one: straight-line fallback (`haversineMeters` origin→ping, ping→destination), `approximate: true`.
- `avgSpeedMps = covered / (latest.recordedAt − startedAt)`; `etaAt = latest.recordedAt + remaining / avgSpeed`; ETA is `null` while `covered < SHORT_DISTANCE_METERS` or elapsed < 1 h (no silly numbers from the first ping).
- `behind = etaAt > dueAt` where `dueAt = expectedDeliveryAt` (end of that Maputo day when it is a date only). Returns `{ coveredMeters, remainingMeters, totalMeters, avgKmh, etaAt, behind, approximate, at: latest.recordedAt }`.
"Recomputed with every update" holds: the page polls the trail; the alert is judged at the two daily slots only (say so on the card tooltip).

### P.3 tRPC
- `movements.trail` (polled by `TrackingCard` every `TRAIL_POLL_MS`) returns `{ points, progress }` instead of the bare array (`procedures.ts:2141`); progress from the cached route + last point, never a Google call.
- `map.overview` (`map/server/procedures.ts:85`) adds `progress: { remainingKm, etaAt, behind } | null` to `MapEntity` for both loads and orders (orders have `order_route` + `order_location`; same pure function).

### P.4 UI
- `movements/sections/tracking-card.tsx`: progress bar covered/total km, "N km remaining", "ETA hh:mm · avg N km/h", "approximate" hint on the straight-line fallback, "Behind schedule" badge when `behind`. Card unchanged when `progress` is null.
- Map page list row + selected card: km remaining and ETA; pin colours stay lifecycle (slide 11 is not in this plan).
- Admin order page: out of scope here (the map overview covers Appload orders for tenants; the admin page can adopt the same function later).

### P.5 Alert
- `TRACKING_ALERT_ISSUE` (`movements.ts:512`) gains `"falling-behind"`. In `issueFor` after the off-route check: `movementProgress(...).behind` → `"falling-behind"` (order: off-route > falling-behind > short-distance).
- `raise`: the client is told on the first streak for `falling-behind` (the slide's promise is "warn the client before they call"); the streak-2 rule stays for the other issues. One condition.
- Copy in `apps/app/src/messages/{en,pt}/notifications.json` for `movement.location-alert` with `issue = falling-behind`, both audiences.

### P.6 Harness (`apps/app/scripts/verify-tracking-progress.ts`, verify-movements skeleton)
- Pure: ping at the polyline midpoint → 50 % and remaining = half; ETA arithmetic; no ETA inside the first hour; straight-line fallback flagged approximate; `behind` true/false around `expectedDeliveryAt`.
- Transition to `on-route` with a fresh `movement_route` seeded → no recompute (cache hit); with none and no Google key → transition still succeeds, no row.
- `trail` returns `progress`; `map.overview` row carries `remainingKm`.
- `reviewMovementSlot` on a load whose latest ping projects an ETA past its due date → alert row `falling-behind`, owner notified, client notified at streak 1; a load on time → no alert.
- Re-run `verify-movements.ts` (trail shape changed).

### P.7 Seed-demo
Seeded on-route loads already carry routes and pings along the polyline, so progress and ETA appear with no change. Add one on-route load whose backdated pings lag its due date so "Behind schedule" and the alert copy are visible. `hushTracking` unchanged.

### P.8 i18n / prod
`App.loads.tracking.progress.*`, `App.map.progress.*`, notification copy above. No migration, no env; Routes API spend moves from "per page open" to "per dispatch", net neutral.


> **AS BUILT (2026-10-01):** as planned, with these calls. Pure arithmetic in `packages/domain/src/tracking/progress.ts` (`movementProgress`, `progressFromRoute`, `dueBy`, self-check via `pnpm dlx tsx`), DB readers in `progress-read.ts` (`departures` off the first on-route status event, `orderDepartures` off `order_history`, `readMovementProgress`), route cache lifted to `packages/domain/src/tracking/route-cache.ts` (`ensureMovementRoute`, never throws; `movements.route` and `transitionMovement` on the move to on-route both call it). The clock runs from the on-route event, not `startedAt` (that is stamped at at-loading). Progress and ETA only in the en-route stages (`EN_ROUTE_STATUSES` = on-route, stopped, issue, at-border): at the offloading site the ETA would be noise. `movements.trail` returns `{ points, progress }`; `map.overview` entities carry `progress: { remainingKm, etaAt, behind } | null` for loads and orders (a linked load reads the order's road and departure). Alert `falling-behind` added to `TRACKING_ALERT_ISSUE` (text enum, no migration), judged after off-route and before short-distance; the client is told on the first round. Copy: `App.loads.tracking.progress.*`, `App.map.progress.*`, notification `fallingBehind` branch. Seed: a third own truck on `L.nacBei`, a fifth of the road in three days, due today. Harness `apps/app/scripts/verify-tracking-progress.ts` 18/18 (the harness env has no Google key, so the "cannot draw" case is the no-key path). Browser: map list shows km to go, ETA and "Atrasado" on the seeded loads; the tracking card on ORD-0038-26 reads 463 of 953 km, 491 km to go, ETA and 15.9 km/h. Not done: pin colours by on-time/late (slide 11, out of scope), admin order page.

---

## Phase T2 — Support access by grant (≈1 d)

### Schema (migration `0028_support_access`)

```
support_access_grant:
  id uuid pk; organization_id notNull FK organization cascade
  granted_by FK user; reason text notNull; expires_at timestamp notNull
  revoked_at timestamp; revoked_by FK user; created_at
  idx (organization_id) where revoked_at is null
```
No RLS on it; staff has select (needs it inside policies). `movement` staff policy gains `or exists (select 1 from support_access_grant g where g.organization_id = movement.organization_id and g.revoked_at is null and g.expires_at > now())` (a grant opens the granting tenant's own books only, never rows that merely name it as counterparty). Same clause on `contract` (owner org) and `partner_connection` (either side = granting org). Drizzle regenerates the changed policies as drop/create.

### Domain / tRPC
- `packages/domain/src/support/grants.ts`: `activeGrant(db, orgId)`, `grantSupport`, `revokeSupport`.
- Portal `me` router: `supportGrants.list / grant({ days: 1|7|30, reason }) / revoke({ id })` — `authorizedTenantProcedure("organization", ["update"])` (owner/admin). Activity catalog: `me.supportGrants.grant/revoke` with `entityType: "organization"`, `organizationId` = tenant.
- Admin `partners` router: `supportAccess({ organizationId })` → active grant or null (read-only badge on the partner profile) and a **minimal read-only "Loads (support)" tab** listing the tenant's movements (reference, status, lane, dates; **no money columns**). The query is a plain `select from movement where organization_id = X`; RLS returns rows only under a live grant. Each call writes an `activity_log` row `support.loads.view` with `organizationId = X` (that is what the tenant's log shows in T3). Without this tab the grant is theatre; with it, support can answer "why is my load stuck".

### UI
Settings gets a `security` tab (whitelist at `settings-view.tsx:46`): `SupportAccessCard` — active grant (who, reason, expires, Revoke), history, "Grant access" dialog (duration + reason, required). Message keys `App.settings.support.*`.

### Harness
`verify-trust-wall.ts` gains: grant by B's owner → staff sees B's movements and costs; revoke → 0; expired row → 0; a grant by B does not open A's rows that name B as carrier; member role cannot grant (`FORBIDDEN`); the admin support tab caller writes the `support.loads.view` activity row.

Prod: `db:migrate` (0028).

> **AS BUILT (2026-10-01):** migration is **0030_support_access** (0028/0029 were taken by the contracts work): `support_access_grant` in `packages/db/src/schemas/support.ts` (no RLS on it; live index on `(organization_id, expires_at) where revoked_at is null`), `supportGranted(col)` helper in rls.ts, and the three staff policies (`movement`, `contract`, `partner_connection`) regenerated by drizzle as `ALTER POLICY` with the grant clause — the allocation policy follows the contract's. Domain `packages/domain/src/support/grants.ts` (`activeGrant`, `grantHistory`, `grantSupport` — one live grant at a time, a new one revokes the current — `revokeSupport`). Portal: `me.supportGrants.list/grant/revoke` (grant/revoke on `organization:update`), catalog entries `me.supportGrants.grant/revoke` with the reason on the row, Settings tab **Segurança** → `SupportAccessCard` (1/7/30 days + reason dialog, history with Open/Expired/Closed early). Admin: `partners.organizationProfile.supportAccess`, `partners.supportLoads` (plain select on `movement`; the staff policy admits the rows; writes `activity_log` `support.loads.view` with `organizationId` = the company, so T3 can show it), profile tab **Support** (`support-tab.tsx`, no money columns, every movement status translated). Verified: `verify-trust-wall.ts` 32/32 (member FORBIDDEN, owner opens, staff reads the load + costs + client list, a grant by B does not open A's row naming B, revoke → 0, expired → 0), new `apps/admin/scripts/verify-support-access.ts` 7/7 on the real staff role (shut: only the loads Appload is a party to; open: all; every read logged). Browser: portal Settings › Segurança as Cliente Teste — opened for a week with a reason, closed again, history says "Fechado antes do fim". Admin tab NOT seen in a browser: localhost shares the auth cookie, so :3000 was signed in as the portal user ("Acesso restrito") — Claire's admin pass owed, as before.

---

## Phase T3 — The tenant's own access log (≈½ d)

- Fix the stamping bug: `recordRequestActivity` (`packages/trpc/src/activity-log.ts`) takes `organizationId` from `ctx.tenantGates()` when `app === 'portal'` (await the memoized gate; falls back to null for onboarding/public), from the explicit `organizationId` for admin support views.
- Migration `0029_activity_log_org_idx`: `index (organization_id, created_at desc)` on `activity_log`.
- Portal `me.activity.list({ cursor, limit })` → rows `where organization_id = tenant`, newest first, joined to `user.name`; `app = 'admin'` rows rendered as "Appload support" with a distinct marker.
- Settings `activity` tab: `ActivityCard` — time, actor, action label (translate the known `movements.*`, `contracts.*`, `me.*`, `auth.*`, `support.*` paths; unknown paths shown raw), entity link when it is a movement/contract.
- Harness: after a mutation as B, `me.activity.list` as B contains it with the right org; A's list does not; the admin support view row appears in B's list.

Prod: `db:migrate` (0029). Rows before this phase have null `organization_id` and will not show; say so on the card ("from <date>").

> **AS BUILT (2026-10-01):** migration is **0031_activity_log_org_idx**. The stamping fix lives in the `protectedProcedure` middleware (`packages/trpc/src/init.ts`): on the portal it awaits the memoized tenant gate and passes `organizationId` into `recordRequestActivity`, which prefers it over the cookie's `activeOrganizationId` (the admin's fallback). `me.activity.list({ cursor?: Date, limit })` is keyset-paged on `created_at`, excludes `session.resumed`, `notifications.markRead/markAllRead`, `threads.markRead`, and flags `app = admin` rows as `support`. Settings tab **Actividade** → `ActivityCard` (infinite query, actor or an "Suporte Appload" chip, action in words from `App.settings.activity.actions.<path with - for .>` with the raw key as fallback, links to the load or the contract, a footer that says the record starts 1 October 2026). Harness: `verify-trust-wall.ts` 35/35 — note it drives the **app router** (`createCallerFactory(appRouter).me`) so the paths and the catalog match; a caller on `meRouter` alone logs `supportGrants.grant` and no entity. Prod: `db:migrate` 0031.

---

## Phase T4 — Data page (≈½ d, only after 0, T2, T3 are live)

Static page `/settings?tab=data` (or `/data` → pt `/dados`, linked from onboarding's last step and the sidenav footer). Plain language, EN/PT, four short sections that must each be true when published: what Appload sees on marketplace loads (Appload is a party), what it cannot open on Enterprise loads (RLS, phase 0), how support access works (T2, link to the tab), what is logged and where to read it (T3). Papers/KYC are seen by staff by design: say it. Link to the Enterprise terms (Frederico's document) once it exists; until then the section is omitted, not promised. No new backend.

> **AS BUILT (2026-10-01):** a public page at `/data` → pt `/dados` (`apps/app/src/app/[locale]/data/page.tsx`, outside both route groups so a company still registering reads it before it has a tenant; no gate, no backend), copy in `apps/app/src/messages/{en,pt}/data.json` mounted as `App.data`: intro + five sections (loads with Appload, your own loads, support access → Settings › Segurança, what is logged → Settings › Actividade, verification papers) + contact line. Linked from the rail's footer ("Os seus dados"), the onboarding screen's foot, and the Segurança card. No terms link yet (document does not exist). Verified in Chrome on dev.

---

## Phase C3 — Contract RFQ (outline only, ≈1–2 d, later)

Award allocations through a round instead of by hand: `contract_request` (contract_id, carrier_org_id, status, quoted price model, quoted share) mirroring `movement_request`; `requestQuotes` on contract create; award N carriers with quantities → creates allocations. Reuses the Quotes card pattern. Migration `0030_contract_request`. Not detailed here.

---

## Registry note (design only, nothing built)

Per `module-registry-plan`, when the registry lands these register as:
- `contracts` — deps `core`, `costs`; nav `/contracts`; resources `contract`; settings schema: `defaultBillableDays`, `defaultCurrency`; plan default: business+.
- `trust` (platform-level, always on, not tenant-switchable) — settings tab `security` + `activity`, resources none new (uses `organization:update`).
Nothing in phases 0–T4 needs the registry; the sidenav entry and permission resource are added directly.

---

## Order and calendar

0 (2 d) → C1 (2 d, demo) → C2 (1 d) → P (2 d) → T2 (1 d) → T3 (½ d) → T4 (½ d) → C3 later. Migrations: 0026 wall · 0027 contracts · 0028 support access · 0029 activity index · (0030 contract RFQ); P has none. Dev applies each by `db:push` (roles script first, once); prod by `db:migrate` per release with the RELEASE.md bullet. One branch per phase (`stage/32-trust-wall` is cut from `stage/31-supabase` because dev lacks the Supabase driver and migration 0025 until PR #29 merges; later phases off `dev`), PRs into `dev`, browser pass in Claire's Chrome per `browser-testing-chrome` before each PR.

## Verification (end to end)

1. Phase 0: `verify-trust-wall.ts` all green; `verify-appload-partner.ts` green with admin callers on the staff role; admin dev server on the staff URL: sign in, open a partner profile, transition an order, open a movement thread from admin → not found; Infobip test pin routes to a portal movement through `serviceDb`.
2. C1: `verify-contracts.ts` and `verify-movements.ts` green; typecheck clean; Chrome as CTP: create contract → activate → allocate to A.S.M. → "File a trip" prefilled → trip page shows ContractCard → contract page shows 1 consumed; as A.S.M.: sees only its allocation; files its own trip under it.
3. C2: fleet page shows "on rental until"; `/contracts` strip shows per-currency lines + MZN total.
4. P: `verify-tracking-progress.ts` green; Chrome as CTP on a seeded on-route load: tracking card shows km covered/remaining, ETA and average speed; the lagging seed shows "Behind schedule"; map list shows km remaining; a manual `trips-tracking` cron run on dev raises one `falling-behind` alert with the client notified.
5. T2/T3: Chrome as A.S.M. owner: grant 7 days with reason → admin partner profile shows the support tab with A.S.M.'s loads → A.S.M.'s Activity tab shows "Appload support viewed loads" → revoke → admin tab empty.
6. Each phase: `seed-demo.ts --reset && --yes` still completes, `hushTracking` leaves no seeded truck on a cron.

---

## Ops as orders (2026-10-01, branch stage/34-ops-as-orders) — AS BUILT

Claire's review: a client has **orders**, some of which take many trips; "contract" is Appload's internal word. Settled: payments per trip rolled up on the order; the parent takes an **ORD** number; a **Várias viagens** section in Pedidos; UI/words/navigation only (tables, domain and router keep their names). Rental stays out of the door.

- **O1 door:** `useNewLoad` gains `kind: single | multi | null` and `choose()`; `NewLoadSheet` asks first (`KindChooser`) unless the caller knew (a share's "file a trip", the lists' empty states pass `kind: "single"`); multi opens `ContractSheet` in create mode, whose bases are `trips | weight` (`CREATE_BASES`; a rental still shows its basis when edited). Copy `App.loads.form.kind.*`.
- **O2 place:** `SECTIONS` += `"multi"` (`STATUS_TABS[*].multi = []`, icon `IconPackages`); the movements slots (`movements/views/list-slots.tsx`) hand the section to `contracts/views/list-slots.tsx` (the old contracts route bodies). Order page at `orders/multi/[orderId]` (pt `/pedidos/multi/[orderId]`); `(protected)/contracts/**` are two redirect pages. Trip rows carry `parent: { id, ref, position, of }` (`loadParents` in movements projection: row_number over the order's live trips) and a chip "viagem 3 de 20 · ORD-…". Rail: Contratos entry gone; the multi section badges `railCounts.proposals` (drafts naming the company as client). Notification/activity links point at the new route; `/quotes` redirects there.
- **O3 money:** `packages/domain/src/contracts/money.ts` `foldOrderMoney` (pure, self-checked): per currency committed/filed/received/receivable/payable/paid/outstanding from the reader's side, per-share breakdown for the owner; the cashflow rule holds (nothing owed while a trip is askable or cancelled). `detailOf` returns `money`, trips carry `settlement/settled/canRecordPayment`, and a client now reads the trips filed for it (visibleMovements). `MoneyCard` under Terms; `TripsCard` Pagamento column + the load page's `PaymentDialog` on the trip (`movements.get` read on demand); the strip gains received/receivable or paid/outstanding by org type; the header counts down ("Faltam 1 800 t · ≈ 60 camiões" once 3 trips are filed).
- **O4 words + numbers:** `createContract` mints **ORD** via `nextReference`; `REFERENCE_KIND` = REQ | ORD; the quote carry-over mints ORD. contracts.json / loads.json / notifications.json / activity labels / data page reworded (pt has no client-facing "contrato" left except the signed-document label and the fleet/partners KYC "Contrato" with Appload, which is a document). RELEASE.md notes the series change (no migration).
- **Verified:** `verify-contracts.ts` 58/58 (ORD number, money rollup, a payment moves it, the carrier reads the same); typecheck app/domain/db clean; Chrome: door → chooser → order form with two bases; Várias viagens section lists the orders; a trip row's chip; the order page.
- **Harness gotchas:** a trip under a share is still *unagreed* until the owner offers and the transporter accepts — only then is anything owed (cashflow rule), and only then does the transporter see the owner's row; a payment bumps the trip's version.
- **Open period (2026-10-01, Claire):** a multi-trip order need not end on a date — it runs as long as the cargo lasts. Migration **0032_open_period** (`contract.ends_on` nullable, CHECK allows null); `derivedState` never expires it; the form has a "Sem data de fim" checkbox; lists and the page read "Desde {date} · enquanto houver carga"; the quote carry-over leaves the period open when a quote had no validity. Harness check added.

---

## Rentals (2026-10-01, branch stage/35-rentals, PR #33 → stage/34) — AS BUILT

Plan approved 2026-10-01 (transporter marks / client disputes; whole period billed unless marked; several trucks per rental; driver check-in in the first cut).

- **R1 model + domain (commit f4d7614):** migration **0033_rentals** — allocation uniques relaxed for lines that pin a truck (+ unique per truck per order, `ends_on` on the line), `rental_day`, `rental_checkin_request`, `contract_payment` (staff policies through line/order; the two check-in tables are service-role tables — **prod needs the grants**, see RELEASE.md). `PriceModelSchema` per-day gains `standbyRate`. Domain `packages/domain/src/rentals/{billing,log,payments,checkin,apply}.ts`; `billing.ts` is pure and self-checked. `sendWhatsAppTemplate` takes any template and up to three buttons; the webhook files `rental-yes|no:<line>:<day>` through `recordRentalAnswer` (believed only when a request went out); cron `/api/cron/rental-checkin` (morning window, WhatsApp only, no SMS); template `appload_rental_checkin` registered by `apps/admin/scripts/infobip-templates.mjs` and documented. Trust wall 35/35 with the five contract tables fenced.
- **R2 portal (in progress):** router `rentals` (list/stats/get/create/update/transition/lines.*/days.*/payments.*) in `apps/app/src/frontend/pages/rentals/server/procedures.ts`, types, zod `backend/schemas/rental.ts`, activity catalog; Pedidos section **Alugueres** (`SECTIONS` += `rental`, slots in `rentals/views/list-slots.tsx`), page `orders/rental/[orderId]` (pt `/pedidos/aluguer/[orderId]`; the multi-trip page redirects a days-basis row there), door card **Aluguer de camião** (`useNewLoad.kind = "rental"` → `RentalSheet`), the contracts list and the share picker leave `basis = days` out, loads on a rented truck carry the flag `TRUCK_ON_RENTAL`, fleet list/profile show `RentalBadge` (`VehicleRow.rental` via `activeRentalOf`). Copy in `messages/{en,pt}/rentals.json` (`App.rentals`). Views: `rentals/views/rentals-{header,stats,data}-view.tsx`, `rental-detail-view.tsx`; sections `rental-sheet` (form), `rental-header`, `terms-card`, `lines-card` (+ AddLineDialog), `diary-card` (month grid per truck, DayDialog marks / disputes / settles), `money-card` (+ PaymentDialog), `file-card`. Rules found in the browser pass: a draft bills nothing (`lineView` returns no days until the order runs); an owner without a priced client sees only the payable half and the payment dialog defaults to the buy leg and its single line; which days count is asked on every rental, priced or not, since the lines' buy rates follow it.
- **R4 harness:** `apps/app/scripts/verify-rentals.ts` — 33/33 (B rents two typed-plate trucks to A; the harness inserts and deletes a truck of A's own for the overlap / flag / badge checks, since neither test tenant has fleet rows on dev). Browser pass 2026-10-01 as Cliente Teste: door → form → page → activate → stopped day → payment → lists; left `ORD-0168-26` on dev. Not yet seen in a browser: the transporter's side (A.S.M. marking), the client's dispute, the fleet badge, R3 live check-in.

---

## One orders table (2026-10-01, stage/35-rentals) — AS BUILT

Claire: no dedicated rail entries for multi-trip orders and rentals; they sit among the orders, told apart by a column. Settled: mapped by state into the sections (draft/proposal → Procura, running → Em curso, closed/expired → Histórico, disputed rental days → Disputas, all in Tudo); the parent and its trips are both rows (the trip keeps its parent chip); the tiles and the money strip keep counting trips, the parent row carries its own figure.

- `SECTIONS` back to seven; `MovementRow.kind` (`trip | multi | rental`) and `MovementRow.order` (state, done/of/unit, trucks, providers). `toMovementRow` stamps trips; `movements/server/standing-orders.ts` reads every multi-trip order and rental the company can see (`standingOrderRows` in contracts procedures, `rentalOrderRows` in rentals procedures, both over the whole visible set), filters them like the trips (scope by the trips' own rule, section by state, the three status tabs that mean the same wait, search, partner, period; positions/costs/under-contract filters are trips-only) and merges them into the SQL page by sort key — the trips' window is widened by the standing count (`windowFor`) and every row's place is its place among its kind plus the other kind before it (`mergePage`). `movements.stats` adds them to `bySection` and to the procurement/prospect/closed tabs.
- Table: a **Tipo** column (kind + "300 t de 2.000 t" / "12 dias"), state chips for parents, lane "Qualquer rota" / site or "Local a definir", period "Até …" / "Em aberto", rig = plate or "N camiões", money = the reader's side drawn so far; a row opens its own page by kind. Rail entries, list slots, list views, columns and list hooks of contracts and rentals deleted; `contracts.list/stats` and `rentals.list/stats` procedures kept (harness-tested). Breadcrumbs on both detail pages read Pedidos / kind. The proposals count joins the Procura badge.
- Check: `apps/app/scripts/verify-standing-orders.ts` — page sequences equal the merged list for every sort, direction and page size. Chrome as Cliente Teste: Tudo 36 with ORD-0168-26 (Aluguer) and CON-0001-26 (Várias viagens) among trips, Em curso 18 with the rental, row click opens the rental page.
- Not done: CSV export stays trips-only; the Disputas status menu counts trips only; a standing order's row has no row menu.
