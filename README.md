# Appload

Appload (logistics / freight) monorepo: the operations admin — orders,
shipper and carrier management, driver & fleet KYC, WhatsApp/SMS chats,
driver tracking and a Google Sheets logbook sync — the partner portal where
shippers and carriers work their own side of those orders, and the public
marketing website.

## Workspace

pnpm + Turborepo monorepo.

| Path | What it is |
|---|---|
| `apps/admin` | Next.js 16 admin app (App Router, next-intl `en`/`pt`, tRPC, Better Auth) — port 3000 |
| `apps/app` | Next.js 16 partner portal: one organization per tenant, orders/quotes/trips/analytics for shippers and carriers — port 3001 |
| `apps/website` | Next.js 16 public website (App Router, next-intl `en`/`pt`, ISR) — port 3100 |
| `packages/db` | Drizzle ORM schemas, migrations (`drizzle/`) and dev-DB scripts (`scripts/`) for Neon Postgres |
| `packages/auth` | Better Auth server/client, email templates, RBAC permission statements |
| `packages/trpc` | tRPC router/procedure factories, staff gate, tenant gate, permissions, activity-log catalog |
| `packages/domain` | Business rules both apps run: the order create/transition doors, KYC gates, KPIs, tracking slots, subscriptions, notifications |
| `packages/comms` | Infobip WhatsApp/SMS sends, phone normalization, QStash cron authorization |
| `packages/maps` | Google Maps route/trail queries and the map components |
| `packages/edgestore` | EdgeStore file buckets (uploads, KYC documents) |
| `packages/i18n` | next-intl plugin, routing, middleware and message catalogs |
| `packages/ui` | Shared shadcn/base-ui component library and inputs |
| `packages/eslint-config`, `packages/typescript-config` | Shared lint / TS presets |

## Getting started

```bash
pnpm install
cp apps/admin/.env.example apps/admin/.env   # then fill in the values
cp apps/app/.env.example apps/app/.env       # same values, three of them different
pnpm dev                                     # admin :3000, portal :3001, website :3100
```

The portal's `.env` takes the admin's values — the two apps share the
database, the auth secret and every service credential, and the portal has
no Google OAuth or Sheets credentials of its own — with three exceptions:
`BETTER_AUTH_URL` and `NEXT_PUBLIC_PORTAL_URL` are the portal's own
`http://localhost:3001`, while `NEXT_PUBLIC_APP_URL` stays the admin's
`http://localhost:3000`.

Other tasks: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format`.

Database: apply migrations with `pnpm --filter @workspace/db db:migrate`
(production) — the shared dev database uses the idempotent scripts under
`packages/db/scripts/` instead (see `RELEASE.md`).

## Contributing flow

- `dev` is the integration branch (deploys the admin dev environment) and
  only changes through pull requests with a green CI run.
- Each app releases from its own production branch: `prod/admin`,
  `prod/app` and `prod/website`. Merging `dev` into one of them and pushing
  *is* that app's release — the apps ship independently. (`main` is
  retired.)
- Branch from `dev` (`stage/NN-<topic>`), open a PR into `dev`, test on
  the dev origin after merge, then release per app when ready.
- CI (`.github/workflows/ci.yml`) runs lint, typecheck and a full build.

## Deployment

Vercel (a dev and a production project for each app, six in all) + Neon.
The branch → project mapping and the full first-release checklist — Neon,
Vercel env vars, Google OAuth/Sheets, Resend, Infobip, QStash cron
schedules, first admin, first partner — live in [RELEASE.md](RELEASE.md).
The portal's own design notes are in
[docs/portal-design.md](docs/portal-design.md).
