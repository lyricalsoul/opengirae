# Setting up openGIRAÊ locally

Read this before touching anything else in `docs/agent/` — the other docs
assume you have a running bot to poke at.

## Prerequisites

- [Bun](https://bun.sh) (the whole monorepo runs on Bun, not Node — `bun run`,
  `bun test`, `bun install`, no `npm`/`yarn`/`pnpm` anywhere)
- Docker (for local Postgres + Redis-compatible storage)

## 1. Install dependencies

```sh
bun install
```

This is a Bun workspace (`packages/**` + `website`, see root `package.json`).
One install at the root covers every package.

## 2. Start local infra

```sh
docker compose -f docker-compose.dev.yaml up -d
```

Brings up two containers:

- **`postgres`** (Postgres 18) on `localhost:5433` (not 5432 — deliberately
  offset to avoid colliding with a system Postgres), user/pass/db all `girae`.
- **`dragonfly`** (DragonflyDB, a Redis-protocol-compatible store) on
  `localhost:6379`. Used for BullMQ queues, DBOS's notification/recv-send
  plumbing, and short-lived state (link codes, pending workflow steps).

Both use named Docker volumes, so data survives `docker compose down` (not
`down -v`).

## 3. Environment variables

Copy `.env.example` to `.env` at the repo root and fill in what you need:

```sh
cp .env.example .env
```

| Var | Required for | Notes |
|---|---|---|
| `DATABASE_URL` | everything | `postgres://girae:girae@localhost:5433/girae` for local docker |
| `DBOS_SYSTEM_DATABASE_URL` | `commandeer` | DBOS's own bookkeeping DB — same Postgres instance, different DB name (`girae_dbos_sys`), created automatically |
| `REDIS_URL` | everything | `redis://localhost:6379` for local docker |
| `TELEGRAM_TOKEN` | Telegram bot | from [@BotFather](https://t.me/botfather) |
| `TELEGRAM_WEBHOOK_URL` | — | leave unset for local dev — `telegram-inbound` falls back to long polling, no public URL needed |
| `DISCORD_TOKEN` | Discord bot | from the Discord Developer Portal |
| `DISCORD_DEV_GUILD_ID` | Discord bot (dev) | set to a test guild ID for instant slash-command registration; unset registers globally (up to 1h propagation) |
| `MISTRAL_API_KEY` / `MISTRAL_MODEL` | `/addcard`'s AI inference | optional locally — inference just fails gracefully without it |
| `DITTO_URL` / `DITTO_API_KEY` | profile/trade/wishlist card images | optional — every image-generating call degrades to `null`/a placeholder without it, nothing crashes |
| `S3_*` | avatar/card image uploads | optional locally for the same reason — uploads just fail, don't block command logic |

**Nothing above is required to get commands responding** except `DATABASE_URL`,
`DBOS_SYSTEM_DATABASE_URL`, `REDIS_URL`, and whichever platform token
(`TELEGRAM_TOKEN`/`DISCORD_TOKEN`) you're testing against. Everything else
(AI inference, Ditto images, S3 uploads) is optional infrastructure that
degrades gracefully — see `02-architecture.md`'s "Third-party services" for
exactly how each one fails safe.

**`website/` has its own separate `.env`** (different cwd for Vite/SvelteKit) —
copy `website/.env.example` to `website/.env` too if you're touching the
Mini App or admin panel. It needs the *same* `TELEGRAM_TOKEN` duplicated in,
since `telegramProcedure` validates Mini App init-data against it.

## 4. Run database migrations

```sh
bun run db:migrate
```

Runs `scripts/migrate.ts` against `DATABASE_URL`. Creates both the app schema
and (on the bot process's first `DBOS.launch()`) DBOS's own system tables.
Re-run this after pulling changes that touch `packages/database/schemas/` or
add a new `drizzle/*.sql` migration file.

## 5. Run the bot

```sh
bun run dev:all
```

Starts all four worker processes in parallel (`--watch`, auto-restarts on
file change):

- `dev:discord-inbounder` (port 8080)
- `dev:telegram-inbound` (port 8081)
- `dev:commandeer` (port 8082)
- `dev:answerer` (port 8083)

Only testing one platform? `dev:telegram-all` / `dev:discord-all` skip the
other inbounder. See `02-architecture.md` for what each process actually does.

## 6. Run the website (optional)

```sh
cd website && bun run dev
```

SvelteKit dev server on `localhost:5173`. The Mini App routes (`/app`) need
real Telegram init-data to render anything past a "only works in Telegram"
gate — see `02-architecture.md`'s website section for how that's normally
tested (a BotFather-configured tunnel, not visiting `localhost:5173` directly
in a browser).

## 7. Run the tests

```sh
bun test
```

Runs every `*.test.ts` across every package against your **real local
Postgres** (no separate test DB, no mocking of the database layer — see
`03-commands.md`'s testing section for why, and the conventions that keep
this safe). Takes a few seconds. If a test leaves orphaned rows behind (a
crashed run, a missing `afterAll`), later runs can fail with
`duplicate key value violates unique constraint` on an unrelated test — see
`05-debugging.md` for how to find and clean that up.

## 8. Sync bot commands (Discord only)

```sh
bun run commands:sync
```

Registers Discord slash commands from every loaded command's `info` (see
`03-commands.md`). Telegram doesn't need this — commands are just `/name`
text, no registration step. Re-run after adding/renaming a command that has
Discord-relevant metadata.
