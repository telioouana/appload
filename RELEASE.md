# Production release checklist (Vercel)

The apps deploy to Vercel (Hobby plan); the admin app has a dedicated Neon
production database. Sections 1–7 are one-time setup for the first admin
release; later releases follow the "Branching & deploys" flow below and
only need step 7's smoke test.

## 0. Branching & deploys

One integration branch, one production branch **per app**, four Vercel
projects, two apps (`apps/admin`, `apps/website`). Each `prod/*` branch
carries the whole monorepo, but only its own app's Vercel project deploys
from it — so the apps release independently, no cherry-picking:

| Branch | App | Vercel project (Production Branch) | Origin | Database / logbook |
|---|---|---|---|---|
| `dev` | admin | `appload-admin-dev` — Production Branch = `dev` | `https://admin.dev.appload.co.mz` | `appload-dev` / DEV DATABASE LOGBOOK |
| `dev` | website | `appload-dev-website` — Production Branch = `dev` | Vercel-assigned; see the project's Domains tab | whichever `DATABASE_URL` the project sets, read-only aggregates |
| `prod/admin` | admin | `appload-admin-prod` — Production Branch = `prod/admin` | `https://admin.appload.co.mz` | `appload-prod` / DATABASE LOGBOOK |
| `prod/website` | website | `appload-website` — Production Branch = `prod/website` | Vercel-assigned, custom domain pending | production DB, read-only aggregates (unused while the home metrics section is behind its flag) |

Both admin origins answer. The `*.vercel.app` aliases the website projects
were documented under (`appload-website.vercel.app`,
`appload-dev-website.vercel.app`) returned 404 on 2026-09-04, so take the
current URL from each project's Domains tab rather than trusting one quoted
here.

A fifth project named plain **`appload`** predates the per-app split. It
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
```

`prod/admin` carries one bootstrap commit that `dev` doesn't have (the
`vercel.json` ignoreCommand tweak below), so admin releases are true
merges rather than fast-forwards — or reset the branch onto `dev` once
and fast-forward from then on.

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
  project is the same shape with Root Directory `apps/website`.
- **Migrations** stay manual: when a release contains new files under
  `packages/db/drizzle/`, run `DATABASE_URL=<prod url> pnpm --filter
  @workspace/db db:migrate` *before* pushing the release merge to
  `prod/admin` (see §1).

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
   **rebuild**, not just a redeploy.

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
