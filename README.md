# Appload

Operations admin for Appload (logistics / freight): orders, shipper and
carrier management, driver & fleet KYC, WhatsApp/SMS chats, driver tracking
and a Google Sheets logbook sync.

## Workspace

pnpm + Turborepo monorepo.

| Path | What it is |
|---|---|
| `apps/admin` | Next.js 16 admin app (App Router, next-intl `en`/`pt`, tRPC, Better Auth) |
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

## Deployment

Vercel (root directory `apps/admin`) + Neon. The full first-release
checklist — Neon, Vercel env vars, Google OAuth/Sheets, Resend, Infobip,
QStash cron schedules, first admin — lives in [RELEASE.md](RELEASE.md).
