# Architecture

openGIRAÊ is a Bun workspace of small, single-purpose worker processes that
never call each other directly — every hop between them goes through a
BullMQ queue (Redis-backed) or, for genuinely stateful multi-step flows, a
DBOS workflow (see `04-dbos.md`). No process holds request-scoped local state
that another process needs to see.

## Packages

| Package | What it does |
|---|---|
| `@girae/common` | Shared types (`Message`, `IncomingCommand`, `PendingResponse`, ...), the `Command`/`CommandArgument`/`Subcommand`/`QuickView`/`Page` decorators, BullMQ queue definitions, the messaging API (`reply`, `awaitTextReply`, `awaitMultiPartyChoice`), logger, avatar refresh, Ditto (image-gen) client, Mistral client. Nothing platform-specific lives here. |
| `@girae/database` | One `*DB` class per domain (`CardsDB`, `UsersDB`, `VanitiesDB`, `AuditDB`, `PromoDB`) in `packages/database/{name}.ts`, plus Drizzle schemas in `packages/database/schemas/`. See `03-commands.md`'s database conventions section. |
| `@girae/telegram-inbound` | Long-polls (or webhooks) Telegram via `telegramsjs`, normalizes an incoming Telegram message into the platform-agnostic `Message` shape, and pushes it onto `commandQueue`. Also handles Telegram-only quirks (topic/thread reply detection, `@othertbot` mention stripping, avatar refresh throttling). |
| `@girae/discord-inbounder` | Same job for Discord, via `discordeno`. Discord commands are real slash commands (registered via `bun run commands:sync`), not free-text `/name` parsing — see `registerCommands.ts`. |
| `@girae/commandeer` | The actual command engine: loads every file under `commands/{all,isAdmin}/`, resolves `@CommandArgument`s, runs guards, dispatches to the matching `Command`/`@Subcommand`/`@QuickView`/`@Page` handler, and (for `useWorkflow: true` commands) launches a DBOS workflow. Pushes replies onto `responseQueue`. |
| `@girae/answerer` | Consumes `responseQueue`, does platform-specific formatting (Markdown→Telegram, Markdown→Discord embed) and rate-limit-aware sending, retries on transient failure. |
| `website` | SvelteKit app, two independent surfaces: a Telegram Mini App (`/app` routes — cards/collections/store/inventory, authenticated via `@tma.js` init-data) and an admin panel (`/admin` routes — cards/categories/users/promo-codes CRUD, `better-auth` + OIDC login). Talks to `@girae/database` directly via tRPC routers (`website/src/lib/trpc/routes/`), not through the bot's queues. |
| `@girae/tests` | Shared test helpers: `mockTelegram()` (replaces `telegramsjs` with an in-memory stub that records sent messages), `bootstrapCommandeerWorkers()` (spins up DBOS + the commandeer/answerer workers for tests that need a real reply round-trip). Also owns `scripts/investigate.ts` — see `05-debugging.md`. |

## Message flow

```
Telegram/Discord
  → telegram-inbound / discord-inbounder   (normalize to Message)
  → commandQueue                            (BullMQ)
  → commandeer                              (parse args, guards, dispatch)
      → useWorkflow? DBOS.startWorkflow(...) : direct call
  → reply() called from inside the handler
  → responseQueue                           (BullMQ)
  → answerer                                (format + send)
  → Telegram/Discord
```

Button clicks and other callbacks take a parallel path: `callback.ts`
(`packages/common/inbound/callback.ts`) parses the callback data prefix
(`qv:`, `pg:`, `cmd:`, or a DBOS-`recv`-coupled event key) and routes to one
of three more BullMQ queues, all consumed by `commandeer`'s `worker.ts`:

- `quickViewQueue` — `@QuickView` handlers (ephemeral popup answers)
- `pageQueue` — `@Page` handlers (in-place pagination)
- `resumeQueue` — resumes a suspended DBOS workflow via `DBOS.send`

A `cmd:name:args` callback (a button that should behave like the clicker
typed a command) goes back through `commandQueue`, indistinguishable from a
real typed command. See `03-commands.md` for what `@QuickView`/`@Page` are
and when to reach for each.

**Free text** (not starting with `/`) is checked against a pending
`awaitTextReply` registration (`pendingText:{chatId}:{authorId}` in Redis) by
`packages/common/inbound/handler.ts`, and if one exists, resumes the waiting
DBOS workflow via `DBOS.send` instead of being dropped.

## Redis / DragonflyDB usage

Not just a BullMQ backend — also used directly for:

- Pending workflow state: `workflow:{workflowID}` hash (button flows, 1h
  TTL), `pendingText:{chatId}:{authorId}` (free-text capture)
- Ad-hoc negotiation state for multi-actor flows that don't map cleanly onto
  a single workflow's closure (e.g. `/trade`'s `trade:state:{workflowID}`)
- Short-lived one-time codes (`/link`'s account-merge code)
- Locks (`girar:active:{telegramId}:{chatId}` — prevents double-`/girar`
  races; see `packages/commandeer/services/girarClaim.ts`/`tradeLock.ts`)

## Storage & third-party services (all optional locally, all fail safe)

| Service | Used for | What happens if unconfigured |
|---|---|---|
| **S3-compatible storage** (`packages/commandeer/services/storage.ts`, `Bun.S3Client`) | Re-hosting Telegram avatar photos, uploading card/vanity/generated images | Upload calls throw/reject; callers already treat a missing image as "render without a photo," nothing crashes command logic |
| **Ditto** (`packages/common/ditto.ts`, `DITTO_URL`) | Generating the actual profile/card/trade/wishlist preview images shown in replies | Every Ditto call (`generateProfileImage`, etc.) returns `null` immediately if `DITTO_URL` is unset — no network call attempted |
| **Mistral** (`packages/common/mistral.ts`, `@mistralai/mistralai`) | `/addcard`'s AI-assisted field inference from a photo | Inference calls fail; the addcard wizard still works, just without auto-filled suggestions |
| **OIDC** (website admin login only, `better-auth` + `genericOAuth` plugin) | Staff login to `/admin` | Not relevant to bot commands at all — regular bot users never touch this |
| **Plausible** (website only) | Basic pageview analytics on the Mini App/admin site | Not relevant to bot commands; worth knowing about if asked what user data is collected |

## Platform abstraction

Everything past the inbounders operates on `Message`/`IncomingCommand`
(`packages/common/commands/types/messaging.ts`) — a shared shape with a
`platform: 'telegram' | 'discord' | 'none'` field. `'none'` is a genuine
test-only no-op platform (see `03-commands.md`'s testing section) — never
used for a real inbound message. A user's identity is unified across
platforms via `linked_accounts` (`platform`, `platformId`) → one `users.id`;
`/link` (`packages/commandeer/commands/all/link.main.ts`) merges two
platform identities into one account.

Command handlers should read `ctx.message.platform` only when a behavior
is genuinely platform-specific (e.g. `mention()` builds a different string
for Telegram vs Discord) — the default assumption is that a command works
identically on both platforms without checking `platform` at all.
