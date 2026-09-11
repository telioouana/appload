# Production release checklist (Vercel)

The apps deploy to Vercel (Hobby plan); the admin app and the partner portal
share one Neon production database. Sections 1–8 are one-time setup for the
first release of each app; later releases follow the "Branching & deploys"
flow below and only need the smoke test (step 7 for the admin, step 8 for the
portal).

## 0. Branching & deploys

One integration branch, one production branch **per app**, six Vercel
projects, three apps (`apps/admin`, `apps/app` — the partner portal —
`apps/website`). Each `prod/*` branch carries the whole monorepo, but only
its own app's Vercel project deploys from it — so the apps release
independently, no cherry-picking:

| Branch | App | Vercel project (Production Branch) | Origin | Database / logbook |
|---|---|---|---|---|
| `dev` | admin | `appload-admin-dev` — Production Branch = `dev` | `https://admin.dev.appload.co.mz` | `appload-dev` / DEV DATABASE LOGBOOK |
| `dev` | portal | `appload-app-dev` — Production Branch = `dev` | `https://app.dev.appload.co.mz` (to confirm) | `appload-dev`, the admin's database |
| `dev` | website | `appload-dev-website` — Production Branch = `dev` | Vercel-assigned; see the project's Domains tab | whichever `DATABASE_URL` the project sets, read-only aggregates |
| `prod/admin` | admin | `appload-admin-prod` — Production Branch = `prod/admin` | `https://admin.appload.co.mz` | `appload-prod` / DATABASE LOGBOOK |
| `prod/app` | portal | `appload-app-prod` — Production Branch = `prod/app` | `https://app.appload.co.mz` (to confirm) | `appload-prod`, the admin's database |
| `prod/website` | website | `appload-website` — Production Branch = `prod/website` | Vercel-assigned, custom domain pending | production DB, read-only aggregates (unused while the home metrics section is behind its flag) |

Both admin origins answer. The `*.vercel.app` aliases the website projects
were documented under (`appload-website.vercel.app`,
`appload-dev-website.vercel.app`) returned 404 on 2026-09-04, so take the
current URL from each project's Domains tab rather than trusting one quoted
here.

Neither portal project exists yet: `appload-app-dev` and `appload-app-prod`
are created as part of this release (§2), and both `app.*` origins above are
the intended names, not observed ones — confirm them (and their DNS records)
in each project's Domains tab and set `BETTER_AUTH_URL` /
`NEXT_PUBLIC_PORTAL_URL` to whatever they turn out to be.

One more project named plain **`appload`** predates the per-app split. It
deploys nothing, but it still builds every pull request and fails, which is
the permanent red `Vercel` check on PRs (#15, #17, #18 and #19 all carry
it). Disconnecting its Git repository (Settings → Git) stops the noise;
deleting the project removes it for good.

`main` is retired as a release branch (kept for history; nothing deploys
from it since 2026-09-02).

Flow: branch from `dev` (`stage/NN-<topic>`) → pull request into `dev` →
CI green → merge → the admin dev project deploys automatically → test on
the dev origin → release each app on its own schedule by merging `dev`
into its `prod/<app>` branch and pushing. **Every push to a tracked
`prod/*` branch is a production deployment of that app** — the push is
the release:

```bash
# Release the website
git checkout prod/website && git merge dev && git push

# Release the admin (run new migrations first — see below)
git checkout prod/admin && git merge dev && git push

# Release the partner portal (same database, same migrations — see §1)
git checkout prod/app && git merge dev && git push
```

`prod/admin` and `prod/app` each carry one bootstrap commit that `dev`
doesn't have (the `vercel.json` ignoreCommand tweak below), so those
releases are true merges rather than fast-forwards — or reset the branch
onto `dev` once and fast-forward from then on.

Why a stable `dev` origin instead of per-PR preview URLs: Better Auth only
trusts `BETTER_AUTH_URL` (+ localhost) and Google OAuth redirect URIs are
registered per origin, so sign-in cannot work on ad-hoc preview hosts.
`apps/admin/vercel.json` therefore carries an `ignoreCommand` that builds
**only production deployments plus the `prod/admin` ref** — feature
branches never produce admin preview deployments; CI is their build check.
(The `prod/admin` ref clause exists because Vercel refuses to save a
Production Branch that has never deployed, and without it the branch's
first deployment could never happen.) The website app has no
`ignoreCommand`: its project builds previews normally.

`apps/app/vercel.json` is the same file for the same reason, and the portal
needs the same bootstrap. On `prod/app` only — never on `dev` — commit the
matching ref clause before the first push, or Vercel will refuse to save
`prod/app` as the Production Branch:

```json
"ignoreCommand": "if [ \"$VERCEL_ENV\" = \"production\" ] || [ \"$VERCEL_GIT_COMMIT_REF\" = \"prod/app\" ]; then exit 1; else exit 0; fi"
```

- **CI** — `.github/workflows/ci.yml` runs `pnpm turbo lint typecheck build`
  on every pull request and on pushes to `dev`/`main`, with placeholder env
  vars only (no secrets, no database). The job is named `ci`. The vetting
  point for a release is the PR into `dev`; pushes to `prod/*` are covered
  by the Vercel build itself.
- **Branch protection** (GitHub → Settings → Rules → Rulesets): target
  `dev` — require a pull request before merging (0 approvals is fine for a
  solo repo), require the `ci` status check, block force pushes. Leave
  `prod/*` open to direct pushes: the push *is* the release.
- **Vercel (admin projects)** — connect the `telioouana/appload` repo, Root
  Directory `apps/admin`, "Include files outside root" enabled; set the
  Production Branch per the table; environment variables from
  `apps/admin/.env.example` with that environment's values. The website
  project is the same shape with Root Directory `apps/website`, the portal
  with `apps/app` (§2).
- **Migrations** stay manual: when a release contains new files under
  `packages/db/drizzle/`, run `DATABASE_URL=<prod url> pnpm --filter
  @workspace/db db:migrate` *before* pushing the release merge to
  `prod/admin` or `prod/app` (see §1).

## 1. Neon — production database

1. Create the production database/project in Neon and copy its
   `DATABASE_URL`.
2. Apply the schema from the committed migrations (never `db:push`
   against production):

   ```bash
   DATABASE_URL=<prod url> pnpm --filter @workspace/db db:migrate
   ```

   Later schema changes ship as numbered migrations under
   `packages/db/drizzle/` (generated with `db:generate`) and are applied to
   production with the same `db:migrate` command. The shared **dev**
   database is on targeted scripts under `packages/db/scripts/` instead —
   never run `db:migrate` against it (the generated `ADD COLUMN` /
   `ADD CONSTRAINT` statements are not idempotent), and never run the
   scripts against production. Note the two env files: the scripts read
   `apps/admin/.env`, drizzle-kit reads `packages/db/.env`.
3. **Data backfills that a migration needs.** A few migrations add a table
   the app then expects to be populated for existing rows; run these right
   after `db:migrate`, before the release deploy:

   - `0011_order_offer` — carrier offers. Every order now carries offers and
     a prospect is booked by accepting one, so each existing order with a
     carrier needs the offer that (retroactively) booked it. Dry-run first,
     read the counts, then write:

     ```bash
     DATABASE_URL=<prod url> node packages/db/scripts/backfill-order-offers.mjs --dry
     DATABASE_URL=<prod url> node packages/db/scripts/backfill-order-offers.mjs --yes
     ```

     Migration `0012_order_offer_pricing` (the commission and client-price
     columns on the offer) must be applied before the backfill runs: the
     script fills those columns from each order's commission and shipper
     leg. The shared dev database got them from
     `node packages/db/scripts/add-order-offer-pricing-columns.mjs`.

     It writes one offer per order — `accepted` for booked-or-later orders,
     `pending` for prospects that already name a carrier — and never edits
     the order rows. Safe to re-run: orders that already have an offer are
     skipped. The shared dev database gets the table itself from
     `node packages/db/scripts/create-order-offer-table.mjs` and then the
     same backfill.

   - `0013_fx_daily_rate` — daily exchange rates. The KPIs page converts every
     trip's money to USD at the rate of its own loading day, so the table
     needs one row per calendar day from the oldest loading date to today, or
     those transports show up as converted at a borrowed rate. Dry-run first,
     read the per-source counts, then write:

     ```bash
     DATABASE_URL=<prod url> node packages/db/scripts/seed-daily-rates.mjs
     DATABASE_URL=<prod url> node packages/db/scripts/seed-daily-rates.mjs --yes
     ```

     Sources are the daily currency feed from 2024-03-02 and Yahoo Finance
     before it, with weekends and the odd unpublished day carried forward from
     the previous close. The app tops up new days by itself afterwards, so
     this is a one-off; it is safe to re-run and never overwrites a day
     already stored. The shared dev database gets the table from
     `node packages/db/scripts/create-fx-daily-rate-table.mjs` and then the
     same seed.

### Partner portal

The portal reads and writes the admin's database — one database, two apps.
Its three migrations go in with the same command as everything else, in one
run — `0014 → 0015 → 0016` back to back:

```bash
DATABASE_URL=<prod url> pnpm --filter @workspace/db db:migrate
```

Run them **before the first `prod/app` push and before any admin release
that carries this branch**, whichever comes first. The admin release is the
easy one to forget: the partner profile's Portal tab reads
`organization_claim` and the new `organization` columns, so an admin
deployed ahead of the migration breaks that tab.

- `0014_portal` — the portal's own tables (`partner_connection`,
  `organization_claim`, `order_request`, `quote`, `trip` with
  `trip_route` / `trip_location` / `trip_tracking_request` (replaced by
  `0016`), and
  `notification` / `notification_cursor`), the columns it adds to tables
  that already exist (`order.source` — which app created the order —
  `organization.subscription_expires_at`, `organization.portal_activated_at`,
  `activity_log.app`) and the indexes the tenant-scoped lists read through.
  No backfill: existing orders keep a null `source`, which reads as "created
  in the admin", and every organization starts with no portal activity.
- `0015_subscription` — subscription model v2. Adds `subscription_usage`
  (one row per tracked movement, per organization, per month) with its
  unique and period indexes, drops the `free` default and the NOT NULL from
  `organization.subscription_plan` (null now means "no plan agreed yet"),
  and remaps the two legacy values in the same statement: `pro` → `business`,
  `free` → NULL. That remap is the whole data step — nothing else has to be
  touched afterwards.
- `0016_movements` — the portal's own loads. The `trip` tables of `0014`
  give way to one `movement` table (a Trip when the company's own fleet
  moves the load, an Order when a partner does, for an agreed price) with
  `movement_route` / `movement_location` / `movement_tracking_request` and
  three new ones: `movement_cost`, `movement_document` and the append-only
  `movement_event`. It creates and drops instead of renaming, which is safe
  only because `0014` has never run on production — there is no `trip` row
  anywhere but dev. It also remaps `subscription_usage.entity_type` `trip` →
  `movement` and deletes `trip.*` notifications, both no-ops on production.
  None of these rows reach the admin, the logbook, the KPIs or the
  commission: a company's own loads are its own.

The shared **dev** database got all three from the idempotent scripts
instead — `node packages/db/scripts/create-portal-tables.mjs`,
`node packages/db/scripts/add-portal-columns.mjs`,
`node packages/db/scripts/add-subscription-usage.mjs`, then
`node packages/db/scripts/rename-trip-to-movement.mjs` (moves an existing
`trip` table across with its rows; a fresh database uses
`create-movement-tables.mjs` instead). Same rule as every other table:
scripts on dev, `db:migrate` on production, **never both** against one
database.

## 2. Vercel — project + environment

1. Import the repo; root stays the monorepo root (Vercel detects the
   Next.js app in `apps/admin` — set Root Directory to `apps/admin` with
   "Include files outside root" enabled, the standard turborepo setup).
2. Set every variable from [apps/admin/.env.example](apps/admin/.env.example)
   in the Vercel project (production environment). Notes:
   - `BETTER_AUTH_URL1` = the production origin. Without it the build/boot
     fails on purpose.
   - `NEXT_PUBLIC_*` values are baked in at build time — changing them
     later needs a rebuild, not just a redeploy.
   - Leave `COOKIE_DOMAIN` unset unless the app must share cookies across
     subdomains of one apex domain.
   - `KYC_ENFORCEMENT`: `warn` to launch, `block` once partners' documents
     are loaded.

### The portal's projects

Two more imports of the same repo, Root Directory `apps/app`, "Include
files outside root" enabled, Production Branch per the table in §0, and the
`ignoreCommand` bootstrap described there. Variables are
[apps/app/.env.example](apps/app/.env.example), grouped by where the value
comes from:

- **Copied from the admin project of the same environment** (dev portal from
  `appload-admin-dev`, prod portal from `appload-admin-prod`):
  `DATABASE_URL`, `BETTER_AUTH_SECRET`, `EDGE_STORE_ACCESS_KEY`,
  `EDGE_STORE_SECRET_KEY`, `EDGE_STORE_PROJECT_ID`, `EDGE_STORE_PUBLIC_HOST`,
  `INFOBIP_BASE_URL`, `INFOBIP_API_KEY`, `INFOBIP_SENDER`,
  `INFOBIP_TRACKING_TEMPLATE`, `INFOBIP_TRACKING_TEMPLATE_LANGUAGE`,
  `INFOBIP_WEBHOOK_SECRET`, `QSTASH_CURRENT_SIGNING_KEY`,
  `QSTASH_NEXT_SIGNING_KEY`, `CRON_SECRET`, `GOOGLE_MAPS_API_KEY`,
  `RESEND_API_KEY`, `EMAIL_FROM`, `KYC_ENFORCEMENT`,
  `NEXT_PUBLIC_GOOGLE_SHEETS_AUTH_MODE`, `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`.
  `DATABASE_URL` and `BETTER_AUTH_SECRET` **must** be byte-for-byte the
  admin's — one database, one auth instance, one cookie signature. The rest
  are identical only because both apps talk to the same accounts; a
  mismatch there makes the two apps behave differently rather than break.
- **The portal's own:**
  - `BETTER_AUTH_URL` — this project's origin. Required, as on the admin:
    the boot fails without it on purpose.
  - `NEXT_PUBLIC_PORTAL_URL` — this project's origin again. Better Auth
    builds the verification, reset and invitation links from it, the
    notification emails link to it, and the QStash script reads it as the
    schedule destination (§6).
  - `NEXT_PUBLIC_APP_URL` — the **admin's** origin, not the portal's: the
    claim email the portal sends ops links into the admin's partner list.
  - `OPS_NOTIFICATION_EMAIL` — the inbox that gets the claim requests the
    portal could not auto-approve. Unset = no email; the claim still queues
    in the admin and a warning is logged.
  - `NEXT_PUBLIC_CONTACT_EMAIL` — the address behind the portal's "talk to
    Appload" prompts (plans are agreed commercially, never bought in the
    portal). Unset falls back to `comercial@apploadafrica.com`.
  - `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — the admin's browser key, once this
    origin is on its referrer list (§3, step 5).
- **Deliberately not set here:** `QSTASH_TOKEN` (only the operator running
  the schedules script needs it; the app never reads it) and `COOKIE_DOMAIN`
  (leave it unset on both apps — it is what would make `admin.*` and `app.*`
  share one session cookie, and the portal refuses staff sessions by design).

`KYC_ENFORCEMENT` means exactly what it means on the admin, because it is
the same door (`packages/domain/src/kyc/order-gate.ts`): the verification
rules are always evaluated and a questionable booking is always flagged for
review; `warn` lets it through, `block` refuses it. Keep both apps on the
same value, or the same order books or not depending on who books it. One
portal-only consequence: a partner has no supervisory role to accept a
flagged risk with, so in `block` mode a booking that needs a manager's
acknowledgement answers `RISK_REVIEW_REQUIRED` and waits for Appload
instead of offering the partner an override.

The portal never calls the Sheets API — that is why it has no
`GOOGLE_SHEETS_*` or service-account variables (it still reads
`NEXT_PUBLIC_GOOGLE_SHEETS_AUTH_MODE`, which `packages/auth` looks at when
it configures the Google provider the portal does not use). An order a
partner creates lands in the `sheet_sync` outbox as `pending`, and the
admin's `appload-sheet-sync` schedule is what pushes it into the logbook —
that schedule stops being a healer and becomes the portal's only route to
the sheet.

### New on the admin projects

Both `appload-admin-dev` and `appload-admin-prod` need one variable they did
not have before this release. It is `NEXT_PUBLIC_*`, so it needs a
**rebuild**, not just a redeploy:

- `NEXT_PUBLIC_PORTAL_URL` — the portal origin of the same environment.
  Better Auth adds it to `allowedHosts`/`trustedOrigins`, and the admin's
  "Invite portal owner" action builds the accept link from it; unset, the
  invitation email points at `/accept-invitation/<id>` on the *admin*
  origin, where that page does not exist.

`apps/admin/.env.example` also lists `OPS_NOTIFICATION_EMAIL`. No admin code
reads it today — the claim email is sent by the portal — so setting it on
the admin projects is harmless but does nothing.

## 3. Google — OAuth + service account + spreadsheets + Maps

1. In the Google Cloud console OAuth client, add the redirect URI:
   `https://<prod origin>/api/auth/callback/google`.
2. `GOOGLE_SHEETS_ORDERS_SPREADSHEET_ID` is the spreadsheet the app syncs
   to (the "DATABASE LOGBOOK"; the dev app points at "DEV DATABASE
   LOGBOOK"). Confirm the service account behind
   `GOOGLE_SERVICE_ACCOUNT_EMAIL` has **editor** access to it — a 403 from
   the Sheets API surfaces as `SHEET_FAILED` in the order's sync badge and
   the `sheet_sync` outbox.
3. The sync expects one tab `ORDERS` holding a Sheets Table named `ORDERS`
   with the header on row 2 and one row per Order Id. Columns are resolved
   by header name (`apps/admin/src/lib/orders/orders-sheet-mapping.ts`
   lists the ones the app writes; a missing header fails the push with
   `HEADER_MISMATCH`); formula cells are never overwritten, and a new order
   is appended into the table body with the neighbouring row's formulas.
   Dropdown columns must carry the labels the app writes — in particular
   `Status` needs: Prospects, Booked, To Loading, At Loading, Loading,
   Waiting Documents, In Transit, Stopped, Issue, At Border, At Offloading,
   Offloading, Delivered, Completed, Cancelled, Underbid.
4. **Seed the logbook's `MONTHLY RATES` tab once per environment.** The
   Metrics page reads the same logbook the sync writes to (step 2) and pins
   each month's opening exchange rate in a `MONTHLY RATES` tab there,
   appending one row a month — the editor access step 2 requires covers it.
   Backfill the history once per logbook: dry-run first, read the table it
   prints, then write:

   ```bash
   node packages/db/scripts/seed-monthly-rates.mjs
   node packages/db/scripts/seed-monthly-rates.mjs --yes
   ```

   The script reads `apps/admin/.env`, i.e. the dev logbook; for production
   add `--spreadsheet <production logbook id>`. It fills every month from
   2022-01 to the current one (Yahoo Finance before March 2024, the daily
   currency feed after) and never overwrites a month already present, so it
   is safe to re-run.
5. **Maps (live tracking map).** Enable the **Routes API** on the server key
   behind `GOOGLE_MAPS_API_KEY` — it already carries Places and Geocoding;
   without Routes every order draws a straight line between geocoded
   endpoints instead of the road. Then create a second, *browser* key with
   the **Maps JavaScript API** enabled and an HTTP-referrer restriction for
   the production origin, and set it in Vercel as
   `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, optionally with
   `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` (a cloud-styled vector Map ID; unset
   falls back to Google's demo style). Both are `NEXT_PUBLIC_*` and are
   baked into the bundle at build time, so changing either needs a
   **rebuild**, not just a redeploy. The portal draws the same maps with
   the same two keys, so **add its origins to the browser key's referrer
   list** — `https://app.appload.co.mz/*` and
   `https://app.dev.appload.co.mz/*` (confirm the hostnames per §0), plus
   `http://localhost:3001/*` if the local dev key is this one. A missing
   referrer entry is silent in the console and shows up as a grey map with
   `RefererNotAllowedMapError` in the browser log. The portal has no Google
   sign-in, so step 1 has nothing to add for it.

## 4. Resend — email

1. Verify the sending domain for `EMAIL_FROM` in the Resend dashboard.
2. In production, an unset `RESEND_API_KEY` makes auth emails fail loudly
   (by design) — set it before the first sign-in that needs email.

## 5. Infobip — WhatsApp/SMS (optional at launch)

Chats and driver tracking degrade gracefully while unconfigured (the
chats page shows a banner; sends fail rather than pretending to succeed).
When enabling:

1. Set the `INFOBIP_*` variables.
2. Point the Infobip inbound webhook + delivery reports at
   `https://<prod origin>/api/chats/infobip` and set the same
   `INFOBIP_WEBHOOK_SECRET` on both sides (the endpoint rejects
   everything while the secret is unset).

The portal changes nothing here. The inbound webhook stays on the **admin**
and remains the single receiver for both apps: its attribution tries the
orders first and only then the portal's own loads, so a location a driver on
one of them shares lands on that load and the thread shows up in the
admin's Messages inbox like any other. On a load handed from one company to
another on the portal, only the row with the truck is a candidate — the
driver is asked once, by the company that employs them, and the pin reaches
the company above by projection. Do not point a second webhook at the portal — the
portal only *sends* (its own tracking cron, §6), and it needs the same
`INFOBIP_WEBHOOK_SECRET` value only because it shares the module that reads
it.

## 6. QStash — cron schedules

1. Set `QSTASH_CURRENT_SIGNING_KEY` + `QSTASH_NEXT_SIGNING_KEY` in Vercel
   (from the Upstash console). Without both, every cron delivery is
   rejected silently.
2. Register the schedules once against the production URL:

   ```bash
   NEXT_PUBLIC_APP_URL=https://<prod origin> QSTASH_TOKEN=<token> node apps/admin/scripts/qstash-schedules.mjs --apply
   ```

   (Dry-run first by omitting `--apply`.) This is a manual step — a deploy
   alone never registers cron.
3. The portal has two schedules of its own, registered the same way against
   the portal's origin:

   ```bash
   NEXT_PUBLIC_PORTAL_URL=https://<portal origin> QSTASH_TOKEN=<token> node apps/app/scripts/qstash-schedules.mjs --apply
   ```

   | Schedule id | Destination | Cron |
   |---|---|---|
   | `appload-app-tracking` | `/api/cron/trips-tracking` | `CRON_TZ=Africa/Maputo */15 8-9,17-18 * * *` |
   | `appload-app-notifications` | `/api/cron/notifications` | `*/5 * * * *` |

   The ids are the portal's own and must never be reused: `appload-tracking`
   is the admin's schedule pointing at the admin's app, and re-registering
   an id repoints it rather than adding one. That is also why an account
   serving both a dev and a production portal can only drive one of them at
   a time with these ids — same constraint the admin's schedules have.

   Budget: ≈ 300 deliveries a day for the portal (288 for the 5-minute
   notification sweep, 16 across the two tracking windows) on top of the
   admin's ≈ 65, so ≈ 370 in all — inside the QStash free tier's 500/day,
   but with little room for a third 5-minute schedule.

## 7. First admin + smoke test

1. Sign in with Google using an `@apploadafrica.com` account — this
   creates the first staff user with the lowest role.
2. Promote it:

   ```bash
   DATABASE_URL=<prod url> node packages/db/scripts/promote-admin.mjs <email>
   ```

3. Smoke test: sign out/in (lands on the Dashboard), create a test order and
   delete/cancel it, open Settings and set a password, run the
   forgot-password flow end to end, open `/metrics` and confirm the cards
   load and no month is marked ≈ (a borrowed rate), confirm
   `https://<prod origin>/api/cron/tracking` answers 401 without a
   signature.

## 8. First partner on the portal

There is no self-serve plan and no payment step: staff decide who gets in
and what they may track. Everything below is on the partner's profile in the
admin, **Portal** section.

1. **Let the owner in**, either way round:
   - the person signs up on the portal and finds the company by NUIT — the
     claim lands in the Portal section, **Approve** makes them the
     organization's `owner`. A claim whose signer's verified email matches
     the organization's own email is auto-approved and never appears here
     (placeholder emails never match, by construction);
   - or **Invite owner** (name + email) — sends the Better Auth invitation,
     whose link is `NEXT_PUBLIC_PORTAL_URL/accept-invitation/<id>`; they
     sign up with that exact address.
2. **Set the plan** in the same section: tier (`starter`, `business`,
   `enterprise`) and an expiry date. Manager and up. "No plan" is a valid
   state, not a broken one — see below.
3. The owner signs in and connects the company to its counterparties
   (search by name or NUIT → request → the other side accepts; a carrier
   that is not on Appload yet can be registered, which creates a pending
   placeholder organization the admin sees in its partner queue).
4. Carriers then register trucks, trailers and drivers — a dispatch needs a
   registered driver and truck, so this comes before the first shipment.
5. Colleagues are invited by the owner from the portal's Settings →
   Members; nothing on the admin side is needed for those.

**What a company can do before a plan is set**: everything except starting
a tracked movement. It can onboard, connect partners, manage fleet and
drivers, file its own loads, send order requests, answer them with offers,
and publish or accept quotes. The doors that ask for a plan are the ones that
start a truck being watched — on Appload's orders, booking (a client
accepting an offer or a standing quote) and the carrier's first dispatch
(`booked → to loading`); on the company's own loads, offering one to a
partner on the portal, the partner accepting it, and putting one on the
road — and they answer `SUBSCRIPTION_REQUIRED` without an active plan,
`QUOTA_EXCEEDED` once the month's tracked movements are spent. Each company
on a load spends its own allowance for it, once. Both
render as an "activate your plan" prompt pointing at
`NEXT_PUBLIC_CONTACT_EMAIL`. Staff are never gated: the same order booked
from the admin goes through, and a movement already on the road is never
made unmovable by a lapsed plan (only the *first* dispatch is charged).

Smoke test, once a partner is in: sign in on the portal and confirm the
dashboard loads; try a staff `@apploadafrica.com` account and confirm the
portal refuses it (`NOT_PARTNER_ACCOUNT`, not a redirect loop); confirm a
second tenant cannot open the first one's order by URL; confirm
`https://<portal origin>/api/cron/trips-tracking` answers 401 without a
signature; create an Appload order in the portal (Appload → Requests) and
confirm it appears in the admin with source `client` and reaches the logbook
after the next `appload-sheet-sync` tick; then file one of the company's own
loads (New load → a partner on the portal), offer it, accept it as that
partner, and confirm it appears on both companies' portals — as an order on
one, a trip on the other — and **nowhere** in the admin's orders or the
logbook.

The movements have a regression script of their own that drives the router
as the dev test tenants and cleans up after itself (dev database only):
`NODE_OPTIONS=--conditions=react-server npx tsx scripts/verify-movements.ts`
from `apps/app`.

## Known deferred items (v1)

- Phone/SMS OTP and the 2FA challenge page — settings cards hidden until
  built; do not re-enable the cards before `/2fa` exists.
- Stats page — nav entry hidden, still deferred. Metrics no longer is: it
  ships as its own entry beside the Dashboard at `/metrics`
  (`/estatisticas` in pt). Nor is the Dashboard, which ships as the landing
  page (`/dashboard` in both locales) above the Ops rail.
- Activity log has no reader UI yet (write-only audit trail).
- KYC file URLs that leaked before the read proxy shipped remain
  fetchable until EdgeStore objects are re-keyed.
- The partner portal's own deferrals and follow-ups (no Google sign-in for
  partners, no KYC self-upload, no mid-trip driver swap, …) are listed in
  [docs/portal-design.md](docs/portal-design.md) §13.
