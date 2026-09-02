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
| `@girae/services` | Home for third-party service integrations. `apple-music/` wraps `@syncfm/applemusic-api` (search, full-resource fetch, artwork URL resolution, cached/tagged preview-audio processing) for Discoteca (Phase 2+). `@girae/common`'s `mistral.ts` migrates here in a later, separate change. |
| `@girae/telegram-inbound` | Long-polls (or webhooks) Telegram via `telegramsjs`, normalizes an incoming Telegram message into the platform-agnostic `Message` shape, and pushes it onto `commandQueue`. Also handles Telegram-only quirks (topic/thread reply detection, `@othertbot` mention stripping, avatar refresh throttling). |
| `@girae/discord-inbounder` | Same job for Discord, via `discordeno`. Discord commands are real slash commands (registered via `bun run commands:sync`), not free-text `/name` parsing — see `registerCommands.ts`. |
| `@girae/commandeer` | The actual command engine: loads every file under `commands/{all,isAdmin}/`, resolves `@CommandArgument`s, runs guards, dispatches to the matching `Command`/`@Subcommand`/`@QuickView`/`@Page` handler, and (for `useWorkflow: true` commands) launches a DBOS workflow. Pushes replies onto `responseQueue`. Also loads `hooks/*.ts` the same way (see "Hooks" below) and emits domain events (`cards:new`) from inside command bodies. |
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

## Hooks: reacting to a domain event without coupling the DB layer to messaging

For behavior that should fire whenever something happens (not whenever a
specific command runs — a card gain happens from `/girar`, `/girar *`,
`/girarauto`, *and* `/trade`), `packages/commandeer/hooks/*.ts` holds
listeners, loaded dynamically at startup by `packages/commandeer/loaders/hooks.ts`'s
`HooksLoader`. Command/hook loading both go through
`packages/commandeer/loaders/`: `base.ts`'s `Loadable` class owns the shared
"`readdirSync` a directory, dynamic `import()` each file" primitive,
`commands.ts`'s `CommandsLoader` uses it for `commands/{all,isAdmin}/*.ts`,
`hooks.ts`'s `HooksLoader` uses it for `hooks/*.ts`, aggregated into a name →
handler map. A hook file is a plain class with one or more `@Hook(eventName)`
static methods (decorator from `@girae/common/hooks`):

```ts
import { Hook } from '@girae/common/hooks'
import type { CardsNewEvent } from '@girae/common/hooks/types'

export default class MyHook {
  @Hook('cards:new')
  static async onCardsNew(event: CardsNewEvent) { /* query the DB, maybe reply() */ }
}
```

- **Events are defined in `packages/common/hooks/types.ts`** (`HookEventMap`,
  one entry per event name) — add a new event there before adding a listener
  for it. `cards:new` (userId, cardId, previousCount, newCount, telegramId,
  displayName, platform, optional completedSubcategories) is the only one
  today, fired once per distinct card whose owned count went up in one
  action. Two listeners react to it, each a different shape:
  - `cativeiroNotify.ts` — does its own check (`rarities.cativeiroThreshold`)
    and DMs the player on first crossing. Use this shape when the check only
    matters to the hook itself.
  - `collectionCompletionNotify.ts` — purely reactive, sends a DM per entry
    in `event.completedSubcategories`. The claim itself (is a subcategory
    now fully owned, credit the coins) happens inside whichever `*DB` call
    granted the card (`CardsDB.addUserCard`/`GachaLogic.runBulkDraws`/
    `CardsDB.executeTrade`, via the shared `CardsDB.claimCompletionsForCardGain`),
    *not* in the hook — because the same command also needs that result
    synchronously to mention the completion inline in its own reply (see the
    "not for anything that needs to block or branch on a reply" rule below).
    Use this shape when a non-hook code path needs the identical result the
    hook reacts to; otherwise prefer `cativeiroNotify.ts`'s self-contained
    shape.
- **Emit from the command layer, never from `@girae/database`** — the same
  layering rule as messaging: `@girae/database` doesn't know about
  `@girae/commandeer` or DBOS. `main/girar.ts`/`cards/girarauto.ts` call
  `emitHook`/`emitCardsNew` (from `../../loaders/hooks`) right after the
  `*DB`/`GachaLogic` call that actually granted the card, using the
  `previousCount`/`newCount` those methods already return.
- **A throwing listener doesn't break the emitting command** — `emitHook`
  catches and logs per-handler, same reasoning as `settleReply()` swallowing
  a permanently failed send. Multiple hook files can listen to the same
  event; each runs independently.
- **Not for anything that needs to block or branch on a reply** — a hook
  handler fires-and-forgets (well, `await`ed by the emitter, but the emitter
  doesn't inspect what it did). If the *command* itself needs to react to an
  outcome, that's normal command logic, not a hook.

## `services/` layout

`packages/commandeer/services/` is split by domain: `cards/`, `vanity/`,
`gacha/`, `users/`, `auctions/` hold logic specific to that domain (e.g.
`services/cards/cativeiro.ts`, `services/vanity/vanityWizard.ts`,
`services/gacha/girarClaim.ts`, `services/auctions/notifications.ts` — see
`04-dbos.md`'s "Scheduled workflows" section for the notification-outbox
pattern this one implements). Framework-core files that every domain
depends on — `commandArguments.ts`, `commands.ts`, `guards.ts`,
`syntheticCtx.ts`, `botInfo.ts`, `supportChannel.ts` — stay flat at
`services/` root rather than being forced into one domain folder. When adding
a new service, put it under the matching domain subfolder; only add a new
subfolder for a genuinely new domain, not a one-off file.

## Redis / DragonflyDB usage

Not just a BullMQ backend — also used directly for:

- Pending workflow state: `workflow:{workflowID}` hash (button flows, 1h
  TTL), `pendingText:{chatId}:{authorId}` (free-text capture)
- Ad-hoc negotiation state for multi-actor flows that don't map cleanly onto
  a single workflow's closure (e.g. `/trade`'s `trade:state:{workflowID}`;
  `/tradedisco` is a separate instance of the same pattern with its own
  `tradedisco:state:{workflowID}` prefix and `services/discoteca/tradeLock.ts`
  — the two negotiation systems don't share keys, so a user can be
  mid-negotiation on both at once)
- Short-lived one-time codes (`/link`'s account-merge code)
- Locks (`girar:active:{telegramId}:{chatId}` — prevents double-`/girar`
  races; see `packages/commandeer/services/gacha/girarClaim.ts`/
  `services/cards/tradeLock.ts`/`services/discoteca/tradeLock.ts`)
- Query result caching: `packages/common/cache/` (`kv.ts` — generic
  get/set/del wrapper around `rawClient`; `users.ts` — the `(platform,
  platformId) → userId` mapping, by far the most frequently re-resolved
  lookup in the system). `@girae/database` intentionally doesn't depend on
  `@girae/common`, so this caching lives in `common`, wrapping calls to
  `UsersDB`'s plain (uncached) methods — never inside `@girae/database`
  itself. Only the id is cached, never the row (coins/isAdmin/etc. always
  come from a fresh read on every call). Whatever writes `linkedAccounts`
  must invalidate: `UsersDB.mergeUsers` repoints another user's linked
  accounts onto the merge target, so its caller (`/link`'s `redeemCode`)
  captures the secondary user's platform ids *before* the merge and calls
  `invalidateCachedUserId` on each *after* — `mergeUsers` itself can't do
  this, since it lives in `@girae/database` and has no path to `common`'s
  cache. `/unlink` (`commands/admin/unlink.ts`) is the reverse case: it
  repoints those same `linkedAccounts` rows back off of the merged account,
  so it invalidates the same way, using the `{platform, platformId}` pairs
  `UsersDB.undoLastMergeForUser` returns in `movedLinkedAccounts` (it knows
  which ones actually moved — some may not have, see `06-prod-operations.md`).

## Storage & third-party services (all optional locally, all fail safe)

| Service | Used for | What happens if unconfigured |
|---|---|---|
| **S3-compatible storage** (`packages/commandeer/services/storage.ts`, `Bun.S3Client`) | Re-hosting Telegram avatar photos, uploading card/vanity/generated images | Upload calls throw/reject; callers already treat a missing image as "render without a photo," nothing crashes command logic |
| **Ditto** (`packages/common/ditto.ts`, `DITTO_URL`) | Generating the actual profile/card/trade/wishlist preview images shown in replies | Every Ditto call (`generateProfileImage`, etc.) returns `null` immediately if `DITTO_URL` is unset — no network call attempted |

`generateWishlistImage`/`DittoWishlistCard.imageUrl` accepts a cativeiro custom **video** URL directly, same as a photo URL — Ditto derives the preview frame on its side. Don't add local video-frame-extraction for this; `ffmpeg` exists in the runtime image (see the Apple Music row below) for Discoteca's preview-audio tagging only, not for this. This is what `/cativeiros` and `/perfil`'s favorite-card image (`packages/common/profileData.ts`) both rely on to show a user's cativeiro customization (`userCards.customMediaUrl`, preferred over the card's default `imageUrl` when set) whether it's a photo or a video.
| **Mistral** (`packages/common/mistral.ts`, `@mistralai/mistralai`) | `/addcard`'s AI-assisted field inference from a photo | Inference calls fail; the addcard wizard still works, just without auto-filled suggestions |
| **Apple Music** (`packages/services/apple-music/`, via `@syncfm/applemusic-api`) | Discoteca entry search, metadata, and preview audio for `/addalbum`/`/addsingle` (Phase 3) | Unofficial, zero-config scraped-session client — no API key to manage. Every wrapper catches its own errors (`searchAlbums`/`searchSongs` → `[]`, `getAlbum`/`getSong`/`getOrProcessPreview` → `null`), so a client or network failure degrades to "no results" rather than crashing command logic |
| **OIDC** (website admin login only, `better-auth` + `genericOAuth` plugin) | Staff login to `/admin` | Not relevant to bot commands at all — regular bot users never touch this |
| **Plausible** (website only) | Basic pageview analytics on the Mini App/admin site | Not relevant to bot commands; worth knowing about if asked what user data is collected |

## Platform abstraction

Everything past the inbounders operates on `Message`/`IncomingCommand`
(`packages/common/commands/types/messaging.ts`) — a shared shape with a
`platform: 'telegram' | 'discord' | 'none'` field. `'none'` is a genuine
test-only no-op platform (see `03-commands.md`'s testing section) — never
used for a real inbound message. A user's identity is unified across
platforms via `linked_accounts` (`platform`, `platformId`) → one `users.id`;
`/link` (`packages/commandeer/commands/main/link.ts`) merges two
platform identities into one account.

Command handlers should read `ctx.message.platform` only when a behavior
is genuinely platform-specific (e.g. `mention()` builds a different string
for Telegram vs Discord) — the default assumption is that a command works
identically on both platforms without checking `platform` at all.

**Replying somewhere other than where the trigger came from**:
`packages/commandeer/services/syntheticCtx.ts` builds a synthetic
`IncomingCommand` for exactly this — `sideCtx(base, telegramId, name, chatId,
threadId?)` swaps chat/author onto an existing `ctx` (a `/trade` negotiation
DM, a staff review topic), keeping everything else (notably `platform`)
inherited from `base`; `buildCtx(platform, telegramId, name, chatId,
threadId?)` builds one from scratch with an explicit `platform`, for the two
cases with no `base` ctx at all — a `@QuickView` handler (never receives
one) and forwarding to a chat whose platform isn't the triggering user's own
(e.g. a Telegram-only staff topic, regardless of which platform the
triggering user is on). Both just feed `reply()`; see `04-dbos.md`'s "Real
platform DMs" section for why this works without a "send to anyone"
primitive.
