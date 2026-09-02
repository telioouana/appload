# Appload

Appload (logistics / freight) monorepo: the operations admin — orders,
shipper and carrier management, driver & fleet KYC, WhatsApp/SMS chats,
driver tracking and a Google Sheets logbook sync — and the public
marketing website.

## Workspace

pnpm + Turborepo monorepo.

| Path | What it is |
|---|---|
| `apps/admin` | Next.js 16 admin app (App Router, next-intl `en`/`pt`, tRPC, Better Auth) |
| `apps/website` | Next.js 16 public website (App Router, next-intl `en`/`pt`, ISR) |
| `packages/db` | Drizzle ORM schemas, migrations (`drizzle/`) and dev-DB scripts (`scripts/`) for Neon Postgres |
| `packages/auth` | Better Auth server/client, email templates, RBAC permission statements |
| `packages/trpc` | tRPC router/procedure factories, staff gate, permissions, activity-log catalog |
| `packages/edgestore` | EdgeStore file buckets (uploads, KYC documents) |
| `packages/i18n` | next-intl plugin, routing, middleware and message catalogs |
| `packages/ui` | Shared shadcn/base-ui component library and inputs |
| `packages/eslint-config`, `packages/typescript-config` | Shared lint / TS presets |

## Getting started

```bash
pnpm install
cp apps/admin/.env.example apps/admin/.env   # then fill in the values
pnpm dev                                     # http://localhost:3000
```

Other tasks: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format`.

Database: apply migrations with `pnpm --filter @workspace/db db:migrate`
(production) — the shared dev database uses the idempotent scripts under
`packages/db/scripts/` instead (see `RELEASE.md`).

## Contributing flow

- `dev` is the integration branch (deploys the admin dev environment) and
  only changes through pull requests with a green CI run.
- Each app releases from its own production branch: `prod/admin` and
  `prod/website`. Merging `dev` into one of them and pushing *is* that
  app's release — the apps ship independently. (`main` is retired.)
- Branch from `dev` (`stage/NN-<topic>`), open a PR into `dev`, test on
  the dev origin after merge, then release per app when ready.
- CI (`.github/workflows/ci.yml`) runs lint, typecheck and a full build.

## Deployment

Vercel (one project per app + the admin dev project) + Neon. The branch →
project mapping and the full first-release checklist — Neon, Vercel env
vars, Google OAuth/Sheets, Resend, Infobip, QStash cron schedules, first
admin — live in [RELEASE.md](RELEASE.md).
