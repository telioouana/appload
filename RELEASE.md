# Production release checklist (Vercel)

The admin app deploys to Vercel (Hobby plan) with a dedicated Neon
production database. Everything below is one-time setup for the first
release; later releases only need step 7's smoke test.

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

## 3. Google — OAuth + service account + logbook spreadsheet

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

3. Smoke test: sign out/in (lands on Orders), create a test order and
   delete/cancel it, open Settings and set a password, run the
   forgot-password flow end to end, confirm `https://<prod origin>/api/cron/tracking`
   answers 401 without a signature.

## Known deferred items (v1)

- Phone/SMS OTP and the 2FA challenge page — settings cards hidden until
  built; do not re-enable the cards before `/2fa` exists.
- Dashboard, Metrics, Stats pages — nav section hidden.
- Activity log has no reader UI yet (write-only audit trail).
- KYC file URLs that leaked before the read proxy shipped remain
  fetchable until EdgeStore objects are re-keyed.
