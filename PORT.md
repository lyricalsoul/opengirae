# Porting old-bot commands to openGIRAE

Playbook for porting a command from the old Telegraf bot (`../neogirae`) into this
DBOS-based bot. Read this before touching a new command — most of what you need
already exists.

## Status: what's ported

New name (aliases) → old equivalent. Update this table when you port
something new or rename/drop a command — it's the fastest way to answer
"did we already build this" without grepping.

| New | Old | Guard | Tier |
|---|---|---|---|
| `/profile` (`perfil`,`me`,`pf`,`pfp`,`ppc`) + `edit`/`emo` subcommands | `profile.ts` | all | plain |
| `/bio` (`biografia`,`biography`) | `vanity/bio.ts` | all | plain |
| `/favcolor` (`cor`,`color`,`corfav`,`corfavorita`) | `vanity/favcolor.ts` | all | plain |
| `/favcard` (`fav`,`favorito`,`favorite`) | `vanity/fav.ts` (card part only — color/emoji split into `/favcolor`/`/profile emo`) | all | plain |
| `/balance` (`balanço`,`atm`,`balanco`) | `users/balance.ts` | all | plain |
| `/clear` (`cancel`,`cancelar`) | — | all | plain |
| `/daily` (`reward`,`recompensa`,`diario`) | `users/daily.ts` | all | plain |
| `/ping` (`pong`) | `misc/ping.ts` | all | plain |
| `/girar` (`rodar`,`rechear`,`carimbar`,`draw`,`gi`) | `cards/girar.ts` + `dbos/workflows/draw.ts` | all | DBOS workflow |
| `/card` (`view`,`ver`) + `cardinfo` quickview | `cards/card.ts` | all | plain + `@QuickView` |
| `/cat` (`cats`,`ctg`) | `cards/cat.ts` | all | plain + `@Page` |
| `/clc` (`sub`,`colec`,`collec`,`col`) w/ `1-5` filters | `cards/clc.ts` | all | plain + `@Page` + `pageFilters` |
| `/cts` w/ `1-3` rarity filters | `cards/cts.ts` + `scenes/crds.ts` | all | plain + `@Page` + `pageFilters` |
| `/bg` (`background`,`papeldeparede`) | `vanity/bg.ts` (view/search+browse; buy split into `/comprar`) | all | plain + shared `@Page` `'vanities'` |
| `/sticker` (`figurinha`) | `vanity/sticker.ts` (same split) | all | plain + shared `@Page` `'vanities'` |
| `/comprar` | `vanity/comprar.ts` | all | DBOS workflow + `equip` `@QuickView` |
| `/addcard` | `admin/addcard.ts` + `legacy-scenes/add-card.ts` | isAdmin | DBOS workflow (`cardWizard.ts`) |
| `/editcard` | `admin/editcard.ts` (re-enters same scene as addcard) | isAdmin | DBOS workflow (`cardWizard.ts`) |
| `/addbg` | `admin/createbg.ts` + `scenes/add-item.ts` | isAdmin | DBOS workflow (`vanityWizard.ts`) |
| `/addsticker` | `admin/createsticker.ts` + `scenes/add-item.ts` | isAdmin | DBOS workflow (`vanityWizard.ts`) |
| `/addcategory` (`addcategoria`) | — (no old equivalent, new) | isAdmin | plain |
| `/addsubcategory` (`addsub`,`createsub`) | `admin/createsub.ts` | isAdmin | plain |
| `/addimgcat` (`setimagecat`,`setimgcat`) | `admin/setimagecat.ts` | isAdmin | plain |
| `/addimgclc` (`setimageclc`,`setimgclc`) | `admin/setimageclc.ts` | isAdmin | plain |
| `/addimgcard` (`setimage`,`setimg`) | `admin/setimage.ts` | isAdmin | plain |
| `/addimgsticker` (`setimagesticker`,`setimgsticker`) | `admin/setimagesticker.ts` | isAdmin | plain |
| `/addimgbg` (`setimagebg`,`setimgbg`) | `admin/setimagebg.ts` | isAdmin | plain |
| `/delcard` | — (old bot had no confirm-button delete; new) | isAdmin | DBOS workflow (confirm/cancel, same shape as `/comprar`) |
| `/setcardsub` (`setcardsubcat`) | — (no old equivalent, new) | isAdmin | plain |
| `/mergesub` | — (not verified against old file) | isAdmin | DBOS workflow (confirm/cancel) |
| `/delsubcategory` (`delsub`) | — (not verified against old file) | isAdmin | DBOS workflow (confirm/cancel, same shape as `/delcard`) |
| `/chocolate` | — (not verified against old file) | isAdmin | plain |
| `/editbg` | — (edit branch over `vanityWizard.ts`, same idea as `/editcard`) | isAdmin | DBOS workflow (`vanityWizard.ts`) |
| `/editsticker` | — (edit branch over `vanityWizard.ts`, same idea as `/editcard`) | isAdmin | DBOS workflow (`vanityWizard.ts`) |
| `/delbg` | — (not verified against old file) | isAdmin | DBOS workflow (confirm/cancel, same shape as `/delcard`) |
| `/delsticker` | — (not verified against old file) | isAdmin | DBOS workflow (confirm/cancel, same shape as `/delcard`) |
| `/commands` (`comandos`,`help`,`ajuda`) | — (no old equivalent, new) | all | plain |
| `/trade` (`trocar`,`troca`) | `cards/trade.ts` + `scenes/start-trade.ts` | all | DBOS workflow (real Telegram deep-link DM negotiation, no `strade`/`htroca`) |
| `/add` (`adicionar`) / `/remove` (`rem`) | — (no old equivalent, new) | all | plain — quick add/remove a card to/from your active `/trade` offer without leaving the DM |

## Status: what's left (surveyed, not yet built)

From a full pass over every remaining `neogirae/packages/commands/{admin,cards,misc,users,vanity}/**`
file not in the table above. Re-verify against the old file before starting
any of these — this is a snapshot, not a spec.

**Easy** (fits existing patterns, no new subsystem): `addalb` (addcard preset
wrapper), `uploadurl`,
`transfercards`, `setapelido`, `giraeban` (needs `isBanned`+`banMessage`
columns, already exist on `users`), `eval` (needs a new `isDeveloper` guard),
`rep`/`reputação` (needs a daily-cooldown flag), `inventory`/`loja` (old versions are already
just stub/fallback text).

**Complicated** (real new work, no new subsystem): `doar` (coin/card gift
with confirm buttons + cooldowns — **not** trading, one-way, no negotiation),
`chicoin` (shares `doar`'s coin-transfer path). `catlock` (restrict which
categories a group can draw from) — needs one new per-group config table +
one check in `/girar`; classified Complicated, not Major, if you're fine with
that scope.

**Major rework** (blocked on a subsystem that doesn't exist — say so, don't
half-build it): `strade`/`htroca` (quick 1-for-1 trade and admin trade-history
report — not ported; `/trade`'s full negotiated flow now covers the actual trading
need, see the status table and "Real Telegram DMs" below), `conectarconta`/
`removerconta`/`contas`/`buscar` (no account-linking subsystem — `buscar` is
double-blocked, also needs per-user card image prefs), `uploadvid` (needs
per-user card image prefs + a staff-approval flow), `fm` (no Last.fm
integration), `cards` (Telegram web app — arguably moot now, `/cts`+`/clc`
already cover in-chat browsing; would need `packages/database`'s new
`maybeTransaction()` dual-mode support either way, see "Database layer
conventions" below).

## Before writing anything

1. **Read the real old-bot file.** Don't paraphrase from memory or a prior
   summary — quote the actual message strings, emoji, and field names. A
   paraphrased summary has already produced a wrong layout once in this repo's
   history. Find it under `neogirae/packages/commands/**` or
   `neogirae/src/legacy-scenes/**`.
2. **Decide if it needs a workflow at all.** See "DBOS vs. plain commands vs.
   pagination" below — most commands don't need `@DBOS.workflow()`.
3. **Check what already exists** in `CardsDB`/`UsersDB`/`VanitiesDB`/`AuditDB`
   before adding a query method. Grep first.
4. **Decide what to drop.** Old bot has features with no equivalent system
   here (Last.fm scrobbles, trade sessions, per-user custom card images,
   moderation-channel posts). Don't build the equivalent system just to port
   one command — drop the feature and say so explicitly in your summary.

## Command anatomy

```
packages/commandeer/commands/<guards>/<name>.<category>.ts
```

- **Filename drives dispatch.** `<guards>` is the directory name, split on
  `+` into guard names (`isAdmin`, `all` = no guard). `<name>.<category>`:
  `name` becomes the registered command name, `category` is just metadata.
  See `packages/commandeer/loader.ts`.
- Every command file `export default class X extends Command` from
  `@girae/common/commands`, with `static override info = { name, description,
  usage?, aliases?, useWorkflow? }` and `static override async execute(ctx:
  IncomingCommand, args?)`. `usage` (e.g. `'/card <nome ou ID do personagem>'`) is
  shown by `/commands` **and** is what a failed `@CommandArgument` resolution
  falls back to (see below) — set it on every new command, not just ones with
  a `Uso:` string. `listCommands()` (`packages/commandeer/loader.ts`)
  exposes the full loaded list (module/category/guards) for anything that
  needs to enumerate commands, e.g. `/commands`' admin-gated section.
- **Guards**: `packages/commandeer/services/guards.ts`. Currently only
  `isAdmin` is registered; unregistered guard names (e.g. `all`) are silent
  no-ops. Add a new guard function there, not per-command.
- **Aliases**: always add the old bot's command name as an alias when you
  rename something (e.g. `/addcategory` created fresh has no old-bot
  equivalent, but `/addsubcategory` aliases `addsub`/`createsub` since the old
  bot called it `/createsub`).
- **Subcommands**: `@Subcommand({ name, description, aliases?, isWorkflow? })`
  from `@girae/common/commands` on a static method — see
  `profile.users.ts`'s `emo`/`edit` subcommands. Dispatch strips the
  subcommand name from `ctx.args` before calling the handler. `@CommandArgument`
  stacks on a `@Subcommand` method exactly the same way as on `execute` (see
  `profile.users.ts`'s `emo` subcommand).

## Command arguments: `@CommandArgument`

Centralizes what used to be ~15 near-identical copies of "parse `ctx.args`,
look something up, handle 0/1/N results, reply with a usage string." Declare
the positional argument list once; the resolved values arrive as a second
`args` param instead of the command re-parsing `ctx.args` itself:

```ts
import { CommandArgument, CommandArgumentType } from '@girae/common/commands'

@CommandArgument([
  { name: 'category', type: CommandArgumentType.CATEGORY },
  { name: 'name', type: CommandArgumentType.STRING },
])
static override async execute(ctx: IncomingCommand, args: {
  category: NonNullable<Awaited<ReturnType<typeof CardsDB.getCategory>>>
  name: string
}) {
  // args.category is already resolved, validated, non-null
}
```

(the resolved value's type is whatever the underlying `CardsDB`/`VanitiesDB`
lookup returns — there's no generated type per spec, write the `args`
annotation by hand matching whichever DB method that type resolves through,
same as every migrated command already does)

- **Types** (`CommandArgumentType`, `packages/common/commands/decorators.ts`):
  `NUMBER`, `STRING`, `HEX_COLOR` (normalizes to a leading `#`), `BOOLEAN`
  (`yes`/`sim`/`1`/`on`/`ativar` → `true`; `no`/`nao`/`não`/`0`/`off`/
  `desativar` → `false`, case-insensitive; anything else fails rather than
  silently defaulting), `USER_MENTION` (reply-to always wins over a typed
  arg; else `@username` DB lookup or a raw numeric telegram ID), `CARD` /
  `CATEGORY` / `SUBCATEGORY` (numeric → lookup by ID; else fuzzy `ilike`
  search with 0/1/N-result handling — a disambiguation list on N, same shape
  every hand-rolled command used to build itself), `VANITY_ITEM` (same
  ID-or-fuzzy-name shape as `CARD`, but needs a fixed `vanityType:
  'background' | 'sticker'` on the spec since `VanitiesDB` has no single
  "any vanity item" lookup — this is why `/comprar`'s `itemId` is still a
  plain `NUMBER`, not `VANITY_ITEM`: it accepts *either* type, and the type
  has no way to search both at once).
- **Only the last spec in the array is greedy** (joins every remaining
  token) — and only for STRING/CARD/CATEGORY/SUBCATEGORY/VANITY_ITEM types;
  NUMBER/USER_MENTION/HEX_COLOR/BOOLEAN always mean exactly one token,
  greedy position or not. Every earlier spec eats exactly one token. This is
  what lets `addsubcategory.admin.ts` do `<id da categoria> <nome com
  espaços>` and `setcardsub.admin.ts` do `<ID do card> <ID ou nome da
  subcategoria>` without any special-casing in the command body.
- **`nullable: true`** — a missing token resolves to `undefined` instead of
  failing. Use this for "browse everything" defaults (`/cat`, `/bg`,
  `/sticker` with no args) and "optional, default to self" args (`/profile
  [@user]`) — the command body decides the default (`args.target ?? ctx.message.author.id`),
  the spec just decides whether *absence* is an error.
- **`guard?: (value, ctx) => boolean | string | Promise<boolean | string>`**
  — runs after a successful type-parse. Return `false` for the generic
  `Uso: ...` fallback, or a string to show a specific message instead (e.g.
  `/bio`'s 100-character cap).
- **No cross-argument validation.** A guard only sees its own value, not a
  sibling arg's — `/mergesub`'s `fromId !== toId` check can't live in either
  spec's `guard` and stays a manual check in the command body, right after
  both resolve.
- **Resolution failures reply exactly once**, then the command's `execute`/
  `@Subcommand` method is never called: a type-specific message (not-found,
  N-result disambiguation) when the parser has one, otherwise the class's
  own `info.usage` wrapped as `` Uso: `...` ``. This is why `CATEGORY`'s
  not-found message lists every existing category (mirrors what `/cat`,
  `/addsubcategory`, `/addimgcat` used to each build by hand) and `CARD`/
  `SUBCATEGORY`/`VANITY_ITEM`'s N-result message is the same disambiguation
  list shape as before — the type owns building that reply now, not the
  command.
- **Not for `@QuickView`/`@Page`** — those take a single already-opaque
  `arg` string from a totally different dispatch path (see "Stateless
  callbacks" below), not `ctx.args`. `@CommandArgument` only applies to
  `execute`/`@Subcommand` methods.
- Resolver lives in `packages/commandeer/services/commandArguments.ts`,
  split into a pure core (`parseCommandArguments` — no Telegram I/O beyond
  the DB lookups CARD/CATEGORY/SUBCATEGORY/VANITY_ITEM/USER_MENTION need, so
  it's safe and fast to unit test directly) and a thin shell
  (`resolveCommandArguments`, wired into `packages/commandeer/services/commands.ts`'s
  `runCommand`) that sends the actual reply on failure. Tests:
  `packages/commandeer/tests/commandArguments/parsing.test.ts` — use
  `platform: 'none'` (a genuine no-op in `answerer/handler.ts`) on any fake
  `IncomingCommand` that needs to exercise the shell without a mocking
  framework or a live Telegram send.
- **Existing NUMBER-only admin ID args are a deliberate choice, not an
  oversight** — wherever a command could plausibly accept a fuzzy name
  instead of a bare ID, it already does (`/delcard`, `/editcard`,
  `/addimgcard`, `/mergesub`, `/setcardsub`, the `del*`/`edit*` vanity
  commands are all `CARD`/`SUBCATEGORY`/`VANITY_ITEM` now, not `NUMBER`).
  `/comprar` is the one remaining `NUMBER` and it's `NUMBER` for the type-
  ambiguity reason above, not because nobody got around to it — don't
  "fix" it back to a fuzzy type without also solving that ambiguity.

## DBOS vs. plain commands vs. pagination

Three tiers, pick the cheapest one that fits:

1. **Plain command** (`useWorkflow` unset/false). No interactivity beyond a
   single reply, or interactivity that's fully stateless (see pagination
   below). This is most commands — `/card`, `/cat`, `/clc`, `/bio`,
   `/favcolor`, all `add*` staff commands.
2. **DBOS workflow** (`useWorkflow: true`, `@DBOS.workflow()` on `execute`).
   Only when the flow is genuinely stateful and needs to *block* waiting for
   an unpredictable next input across multiple steps — button clicks via
   `DBOS.recv`/`send`, free-text capture via `awaitTextReply`. Examples:
   `/girar`'s category→subcategory→confirm chain, `/addcard`'s AI-preview
   edit loop. See "Workflow button/text flow" below.
3. **Stateless pagination** (`@Page` decorator). For "Next/Prev page" UIs
   where the full state needed to render any page fits in the callback data
   itself (e.g. `categoryId` + page number). **Do not use DBOS for this** —
   see "Pagination" below for why.

Rule of thumb: if you can compute the response from `(who clicked, what
arg, what page)` alone with a DB query, it's stateless (`@Page` or
`@QuickView`). If the next step depends on a chain of *previous answers*
that can't be re-derived from scratch, it's a DBOS workflow.

## Messaging (`packages/common/dbos/messaging.ts`)

- `reply(ctx, content)` — `content` is either a plain `MessageReply` (string
  or `{content, photoUrl?, editMessageId?, buttons?, buttonRows?,
  captionOnly?}`) or `InlineReplyOptions` (`{content, eventName, options,
  restricted, rows?, ...}` — the DBOS-`recv`-coupled button flow, only
  meaningful inside a workflow). **Returns `Promise<string | undefined>`** —
  the sent/edited message's ID on success, `undefined` if the send
  ultimately failed after retries. This is a real capability, not just a
  side effect: it's what lets `/trade` track `dmMessageId`/`groupMessageId`
  and edit those exact messages in place later from a totally different
  event (a `@QuickView` add/remove click on a different message entirely).
- **Method selection**: no `photoUrl` → `sendMessage`/`editMessageText`.
  `photoUrl` + no `editMessageId` → `sendPhoto`/`sendAnimation` (new
  message). `photoUrl` + `editMessageId` → `editMessageMedia` **unless**
  `captionOnly: true`, in which case `editMessageCaption`. Pass
  `captionOnly: true` when you're re-editing a message that already has
  this *exact* photo attached and only the caption/buttons changed —
  `editMessageMedia` with an unchanged URL is what Telegram answers with
  "message is not modified" (see `/trade`'s finalize-step "waiting on X"
  nudges, which reuse one cached image URL across every repeat edit).
- **GIFs**: Telegram rejects `sendPhoto` for gifs/videos — `isAnimatedMediaUrl()`
  sniffs the outgoing URL's extension (`.gif`/`.mp4`/`.webm`) and routes to
  `sendAnimation` instead, automatically, for every `photoUrl` you pass.
- A permanently failed send (bad content, blocked user, rate limit exhausted
  after 3 retries) does **not** throw into the calling workflow —
  `settleReply()` catches and logs it, returning `undefined`. Don't remove
  this: `reply()` awaiting the job's result is what makes the return value
  above useful, but a workflow crashing because one Telegram send failed
  would be strictly worse than the old fire-and-forget behavior.
- `deleteMsg(ctx, messageId)`.
- `awaitTextReply(cmd, eventName)` — registers the sender's *next* plain
  (non-`/`) message to resume a workflow via `DBOS.recv<{value}>(eventName)`.
  Only useful inside a `@DBOS.workflow()`.
- **`reply`/`deleteMsg`/`awaitTextReply` are DBOS steps** (via a `maybeStep()`
  wrapper at the top of `messaging.ts`, same dual-mode shape as
  `maybeTransaction` — `DBOS.isWithinWorkflow()` instead of
  `DBOS.isInitialized()`). This matters: `DBOS.launch()` replays any workflow
  still suspended on a `DBOS.recv()` (e.g. an abandoned `/addcard` wizard) on
  every process start. Without step-wrapping, a replay has no record these
  side-effecting calls already ran and **resends every message the workflow
  sent so far** — this was a real, live bug (confirmed via duplicate
  `sendPhoto` jobs piling up in the `{responses}` queue for the same
  `/addcard` preview, every time the dev process restarted). Any new
  side-effecting call added inside a workflow needs the same treatment, or it
  will silently re-fire on every recovery replay.
- **Button rows**: `InlineReplyOptions.rows?: number[]` lays `options` out
  into rows by size (e.g. `[4, 4, 1, 1]`); omit for one flat row. Use
  `groups()` from `@girae/common/utilities/groups` directly if you ever need
  the same row-chunking outside `reply()`.

## Workflow button/text flow (real DBOS state)

Pattern (see `girar.main.ts`; `addcard.admin.ts`/`editcard.admin.ts` delegate to
the shared loop in `packages/commandeer/services/cardWizard.ts` instead of
inlining it — see "Shared wizards" below):

```ts
@DBOS.workflow()
static override async execute(ctx: IncomingCommand) {
  await reply(ctx, { content, eventName: 'foo', restricted: 'author', options })
  const selection = await DBOS.recv<{ value: T, messageId?: string }>('foo')
  // ...loop, re-`reply()` with `editMessageId: messageId` to update in place...
}
```

- `reply()`'s `InlineReplyOptions` branch stores a `StoredStep` in a Redis
  hash `workflow:{workflowID}` (1h TTL — **this flow silently dies after an
  hour**, that's fine for "confirm this add" but wrong for anything meant to
  stay usable indefinitely).
- Free text: `await reply(...)` a prompt, `await awaitTextReply(ctx,
  'eventName')`, `await DBOS.recv<{value: string}>('eventName')`. The same
  `eventName` can be reused across loop iterations (each `reply()` call
  re-registers it) — this is how `/addcard`'s edit-any-field loop works.
- `restricted: 'author'` limits clicks to the original sender; enforced in
  `packages/common/inbound/callback.ts`. **Order matters there**: the pending
  event's Redis hash field must be `hDel`'d *after* the `restricted`/option
  checks pass, not before — deleting first (a real bug, since fixed) means a
  non-author's click (or any click with a stale/invalid option index)
  permanently destroys the event, and the real author's subsequent click then
  hits a missing key and silently no-ops forever, even though the buttons are
  still visibly there.

## Multi-party button flows: `awaitMultiPartyChoice`

`reply()`'s `InlineReplyOptions` already supports `authorIds: string[]` (more than one
allowed clicker), but on its own that only answers "is this click from an allowed
person," not "which of them clicked, and is *this* click valid right now." Two gaps
closed for this (`packages/common/dbos/messaging.ts`, `packages/common/inbound/callback.ts`,
`packages/commandeer/worker.ts`), both additive — every existing single-author workflow
is unaffected:

- `InlineReplyOptions`/`StoredStep` gained `multiUse?: boolean` (default off = today's
  behavior). When set, `callback.ts` does **not** auto-`hDel` the pending event after a
  click — an invalid click (wrong role, stale state) is simply ignored and the buttons
  stay live for the next click, instead of the old single-consumer behavior where *any*
  authorized click — even an invalid one — permanently destroyed the event (the exact
  bug this section already warned about for the single-author case, just not yet closed
  for "right group, wrong role").
- `clickerUserId` is threaded through `callback.ts` → the resume queue → `worker.ts`'s
  `resumeWorker` → `DBOS.send`, so a workflow's `DBOS.recv<{value, messageId,
  clickerUserId}>()` knows *who* clicked, not just that an allowed person did.

Don't hand-roll the loop over these primitives — use
`awaitMultiPartyChoice(cmd, eventName, content, options, authorIds, isValid,
timeoutSeconds?)` (`packages/common/dbos/messaging.ts`, next to `reply()`/
`awaitTextReply`). It posts the buttons (`multiUse: true` under the hood), loops
`DBOS.recv` until a click satisfies your `isValid(choice)` predicate, explicitly
`hDel`s the event once it does, and returns `{data, clickerUserId, messageId}` (or
`null` on timeout, if you passed one). `isValid` can carry its own mutable state
across calls (see `/trade`'s finalize step, which accumulates two separate "I'm done"
clicks before resolving). Any future two-or-more-party confirm (a counter-offer flow,
a dual-staff-approval gate) should reach for this instead of re-deriving the
`multiUse`/`clickerUserId` mechanics.

## Real Telegram DMs, without a "send to anyone" primitive

`/trade` needed the new bot's first genuine private-message flow. The new bot has
**no** "send a DM to an arbitrary user" function, and deliberately doesn't need one —
Telegram itself forbids a bot from messaging a user who hasn't messaged it first, so
any such primitive would just fail silently against that platform rule anyway. Instead:

1. Post a **URL button** (not a callback button) pointing to
   `https://t.me/{botUsername}?start=<payload>` — `getBotUsername()`
   (`packages/commandeer/services/botInfo.ts`, lazy `tg.getMe()`, cached for the
   process lifetime) supplies the username.
2. Clicking it opens a private chat with the bot and sends `/start <payload>` **as
   that user** — this is what legitimizes everything that follows. `start.main.ts`
   dispatches on the payload (currently just `trade`); extend it, don't create a
   second `/start`-like command, for any future deep-link need.
3. From inside a running workflow that only knows the *original* (e.g. group) chat,
   message into the private chat that `/start` just opened by building a shallow
   override of the `IncomingCommand` — same `workflowIDToBeAssigned`, swapped
   `message.chat`/`message.author` — and calling the ordinary `reply()` with it. No
   messaging-layer changes needed for this part: button-click routing (`workflow:{id}`
   Redis hash, `DBOS.recv`/`DBOS.send`) is keyed by workflow ID, not chat. See
   `sideCtx()` in `trade.cards.ts`.

**Views updated from external events**: `reply()` returns the sent/edited message's
ID (see "Messaging" above), so a view can be re-edited in place later even when the
trigger is a completely different message's button — `/trade`'s DM offer display
re-renders in place every time a card is added/removed via `@QuickView`s on the
`/card` command's buttons, not the DM message itself. `/trade` tracks
`dmMessageId`/`groupMessageId` per side in its Redis state (see below) precisely so
each re-render knows which message to edit. This used to be a real limitation
(`reply()` was fire-and-forget) — it isn't anymore; don't reintroduce a
send-a-fresh-message-every-time workaround for a new command that needs the same
shape, just track the returned message ID like `/trade` does.

## Negotiation state for multi-step, multi-party flows: Redis, not workflow closures

`/trade`'s add/remove/ready actions arrive via `@QuickView`s (`tradeCard`,
`tradeReady` in `trade.cards.ts`) triggered from a *different* command (`/card`'s
button) or a different message than the one the workflow is currently blocked
rendering. A `@QuickView` handler has no access to a specific running workflow's local
variables — it's resolved globally by name (see "Stateless callbacks" above) and runs
as a plain stateless request handler. So the negotiation state (both offers, ready
flags, which DM chat is open for each side) lives in Redis (`trade:state:{workflowID}`,
JSON blob, TTL-refreshed on every write), not in the workflow function's closure. The
QuickView handlers do the actual validation and mutation against that state directly
(same "a real mutation riding the popup mechanism" shape already established for
`equip`) and then send a lightweight ping into the workflow's `DBOS.recv` loop, which
just re-reads the current state and re-renders — it doesn't own or duplicate the
mutation logic. Reach for this shape whenever a workflow needs to react to actions that
don't arrive as a click on a message the workflow itself is holding open.

**The Ditto trade image is always attached, from the very first message.**
`renderTradeImage()` never returns `null` — a Ditto failure falls back to
`FALLBACK_TRADE_IMAGE` (a static placeholder URL) instead of omitting the
photo. This matters more than it looks: without a guaranteed image, one
unlucky Ditto hiccup on the *first* render of a message would create it as
plain text (no `photoUrl` that tick), and every later tick's attempt to
attach a photo to that now-existing message is a `captionOnly: false` edit
— fine, `editMessageMedia` does support converting a text message to a
photo message (verified against Telegram's own API directly, despite it
looking like it shouldn't work). The group/invite message gets its image
from message #1 (computed via `emptyOffersState()` before the accept/decline
buttons even go out), specifically so nothing downstream has to special-case
"this message might still be text-only."

**`telegramsjs`'s `editMessageMedia` wrapper is broken for URL-based media
— call the HTTP API directly instead.** `packages/answerer/platforms/telegram.ts`'s
`editMessageMediaRaw()` bypasses `tg.editMessageMedia()` entirely. The
library's request builder switches to multipart form-encoding whenever a
payload has a top-level `media` key (checked by field *name*, not shape),
then its multipart serializer only knows how to attach a plain string/
buffer/stream under that key. `editMessageMedia`'s `media` param is a
*nested* `{type, media, caption}` object (unlike `sendPhoto`'s bare-string
`photo`), so it silently fails to serialize at all and Telegram rejects the
request with `Bad Request: parameter "media" is required` — every single
time, not intermittently. `sendPhoto`/`sendAnimation` are unaffected (their
media value really is a plain string). Confirmed by testing the raw HTTP
call directly against Telegram's API with a bogus message ID: the error
changed from "media is required" to "message to edit not found" once the
payload was built by hand, proving the payload shape itself — not Ditto,
not this codebase's message-flow logic — was the actual defect. Don't route
`editMessageMedia` back through the library without re-verifying this.

## Shared wizards: when two commands need (almost) the same workflow

When a workflow's loop is needed by more than one command (create vs. edit,
or two near-identical creation flows), extract the loop into a plain function
in `packages/commandeer/services/`, parameterized by a `mode` (and whatever
else differs), rather than duplicating the loop or cramming both flows into
one command file:

- **`vanityWizard.ts`**'s `addVanityItem(ctx, type: 'background' | 'sticker')`
  — shared by `/addbg`/`/addsticker`, parameterized by `type`.
- **`cardWizard.ts`**'s `runCardWizard(ctx, { cardData, photoUrl, mode: 'create'
  | 'edit', existingCardId? })` — shared by `/addcard`/`/editcard`. The
  *entry* logic differs a lot (`/addcard` requires a reply + runs AI inference;
  `/editcard` requires neither, just loads the existing card and makes the
  photo optional) but the rarity-buttons/edit-fields/confirm-cancel loop and
  the preview rendering are identical, so only the **commit step** branches
  on `mode` (`createCard` vs. `updateCard` + `setCardSubcategories`, plus a
  field-level diff — `diffFields()` — logged into the `card.edit` audit entry,
  ported from old bot's `calculateChangesBetweenObjects`). Each command's
  file becomes just "resolve my mode-specific inputs, then call the shared
  wizard" — see `addcard.admin.ts`/`editcard.admin.ts`, both under 60 lines.
- When editing reuses a "does this already exist?" check that also applies to
  fresh creation (e.g. `/editcard`'s duplicate-name-and-subcategory check),
  make sure it **excludes the thing being edited from matching itself** —
  otherwise saving a card without renaming it falsely flags itself as a dup
  of itself. Real bug caught while building `/editcard`, not hypothetical.
- `cardWizard.ts`'s create/edit success message carries `cardActionButtons(cardId)`
  — **Editar**/**Deletar**, both via `runCommand` (see "Buttons that start a
  fresh command" below) rather than a QuickView, since both open a real
  multi-step flow (`/editcard`'s wizard, `/delcard`'s confirm/cancel), not an
  instant action.
- `CardsDB.deleteCard(id)` deliberately does **not** cascade into user-owned
  data (`userCards`, `cardDrawHistory`, `users.favoriteCardId`) — none of
  those FKs have `onDelete: cascade`, on purpose. It only clears the card's
  own `cardSubcategories` bookkeeping, then attempts the delete; if anyone
  already owns/drew/favorited the card, Postgres itself rejects it with a FK
  violation (`23503`), and the whole `maybeTransaction` rolls back atomically
  (the `cardSubcategories` clear included). `/delcard` catches that code and
  reports "already owned" instead of crashing — same shape as `/comprar`'s
  `23505` handling. Don't build cascade/soft-delete logic for this; the FK
  constraint *is* the safety net.
- **`CardsDB.deleteSubcategory(id)` is the opposite call**: it *does* cascade
  (`cardSubcategories`, `cardDrawHistory`, `chocolateFactoryCorrections` all
  have `onDelete: cascade` referencing `subcategories.id`) and is gated
  purely on current card count (`has_cards` if any card still lists this
  subcategory). The asymmetry is deliberate, not an oversight: a card's
  owner/draw-history rows are real user-owned state worth protecting behind
  a hard FK rejection; a subcategory's draw-history rows and chocolate-
  factory name corrections are just bookkeeping that's fine to disappear
  alongside the subcategory itself — the old version additionally blocked
  deletion on any *historical* draw from that subcategory, which meant a
  subcategory that had been fully emptied of cards could still never be
  deleted. See `/delsubcategory` and
  `packages/database/tests/subcategory/deleteSubcategory.test.ts`.

## Stateless callbacks: `@QuickView` and `@Page`

Two decorators from `@girae/common/commands`, both registered per-command and
resolved globally at load time (`packages/commandeer/loader.ts`'s
`findQuickView`/`findPage`) since the callback data only carries a handler
name, not which command declared it. **Neither touches DBOS or Redis
workflow state** — everything needed to answer lives in the callback data
string itself. Use these instead of a workflow whenever the response is a
pure function of `(arg, page?, viewer?)`.

### `@QuickView({ name })` — ephemeral alert popup

```ts
@QuickView({ name: 'cardinfo' })
static async cardinfo(arg: string): Promise<string> { ... }  // returned text shows as a Telegram alert
```

Trigger from any `MessageReply.buttons` entry:
`{ text: '🧁', quickView: { handler: 'cardinfo', arg: String(id) } }`.
Callback data shape: `qv:{handler}:{arg}`. Routed straight to
`answerCallbackQuery` via the `{quickviews}` queue + `quickViewWorker` in
`packages/commandeer/worker.ts` — no message is edited.

The handler also receives the clicker's telegram id as a second argument —
`(arg: string, clickerUserId: string) => Promise<string>` — for handlers whose
answer depends on *who* clicked, not just `arg` (existing handlers that don't
need it just ignore the extra param). See `equip` in `comprar.vanity.ts`: it
writes `equipedBackgroundId`/`equipedStickerId` for whoever clicked, then
returns a confirmation alert — a real mutation riding the "ephemeral popup"
mechanism, which is fine since the write is idempotent-safe and instant
(no confirm step needed, unlike a purchase).

### `@Page({ name, restricted? })` — in-place pagination

```ts
@Page({ name: 'cat', restricted: true })
static async catPage(arg: string, page: number, authorId: string) {
  return { content, photoUrl?, hasNext, totalPages? }  // or null if arg no longer resolves
}
```

- Callback data: `pg:{handler}:{page}:{authorId}:{arg}` — fully
  self-describing, no TTL, works indefinitely.
- `restricted: true` makes the `{pages}` worker **ack the callback with a
  "Essa ação não é sua! 😅" alert** and drop the click otherwise (this used
  to be a silent no-op — real bug, the click's loading spinner just sat
  there forever with no feedback at all; fixed by threading
  `callbackQueryId` through `callback.ts`'s `pg:` branch into the
  `pageQueue` job, which `pageWorker` didn't have before). Set `restricted`
  whenever the page content is viewer-specific (e.g. `/clc`'s per-user
  ownership counts derive `authorId` as "the viewer" — safe *only* because
  `restricted: true` guarantees the clicker is always the original author).
- **`totalPages`**: return it whenever you can compute it (every current
  `@Page` handler does) — it's what powers the first/prev/next/last nav row
  below. Omitting it just means "first"/"last" never show, `hasNext` alone
  still drives prev/next fine.
- Trigger the first page directly from the command's own `execute()` by
  calling the same rendering function the `@Page` handler calls (see
  `cat.cards.ts`/`clc.cards.ts` — both have a shared `renderPage()` used by
  both `execute` and the decorated method, so there's exactly one place that
  builds the content string) **and** the same `pageNavRow()` helper the
  worker uses (see below) — don't hand-build page 0's button row separately,
  that's exactly how "last" ended up missing from the first page for every
  `@Page` command at once (each one hand-rolled its own single "next"
  button instead of calling the shared nav-row builder).
- **Why not DBOS**: a Prev/Next click is fully re-derivable from `(handler,
  page, arg)` — there's no real state to persist across clicks, and parking
  a DBOS workflow around just to answer that would burn workflow bookkeeping
  for nothing, plus inherit the 1h Redis TTL that makes no sense for
  "browsing," which isn't a time-boxed action the way "confirm this add" is.
- **Extra static button rows** (e.g. filter toggles above Prev/Next): a
  `@Page` handler can return `extraRows?: Array<Array<{text, arg, page}>>>` —
  each button gets its own target `arg`/`page`, the worker builds the `pg:`
  callback data for all of them using the handler's own name from job
  context. Rendered *above* the Prev/Next row (see `pageWorker` in
  `worker.ts`). Use this for anything beyond plain pagination rather than
  inventing a parallel button mechanism.
- **Multi-row replies outside a `@Page` handler**: `MessageReply.buttons` is
  one row; `MessageReply.buttonRows: ButtonSpec[][]` is explicit multi-row
  (takes precedence if both are set). Needed for e.g. `/clc`'s *first*
  render, which has to show the same filter row + nav row that later page
  turns render via `extraRows` — don't hand-roll button-shape conversion in
  a command file, `ButtonSpec` (exported from `@girae/common/dbos/messaging`)
  is the one shape both `buttons` and `buttonRows` use.

### Toggle filters on top of `@Page` (`@girae/common/utilities/pageFilters`)

Generic, reusable — not tied to any one command. Convention: a filterable
handler packs its `arg` as `"{activeFilterIds}:{realArg}"` (e.g. `"135:7"`,
or `":7"` with nothing active). The pagination core (`pageWorker`, the `pg:`
callback format) never needs to know this convention exists — it only ever
sees `arg` as one opaque string; filters are a convention the *handler*
imposes on its own `arg`, nothing more.

```ts
interface FilterDef<T> { id: string; emoji: string; description: string; match: (item: T) => boolean }

parseFilterArg(arg)               // "135:7" -> { active: ['1','3','5'], rest: '7' }
buildFilterArg(active, rest)      // -> "135:7"
applyFilters(items, defs, active) // AND across every active filter's `match`
filterAdviceText(defs, active, count, noun) // "🔎 Mostrando apenas {noun} **X e Y** (`N` resultados)"
filterButtonsRow(defs, active, rest)        // -> one `extraRows`-shaped row, ✅ when active, always resets to page 0
```

See `clc.cards.ts` for the reference usage: define `FilterDef[]` next to the
command (the `match` predicates are domain-specific — they belong with the
command, not in shared `constants.ts`), call `applyFilters` before
pagination-slicing, spread `filterButtonsRow(...)` into `extraRows`.
**AND semantics deliberately differ from the old bot**: old `col.ts` let
"owned" and "not-owned" silently overwrite each other if both were toggled
(the second `if` clobbered the first's filter object) — here, selecting
both correctly yields zero results instead of one silently winning.

### Rendering a `@Page` handler's own buttons from `execute()`

`toPageButton(handler, { text, arg, page })` (exported from
`@girae/common/dbos/messaging` next to `ButtonSpec`) converts an `extraRows`-
shaped button into a `ButtonSpec` for a given handler name — the same
conversion a command's `execute()` needs when it renders page 0 directly
(see `clc.cards.ts`/`bg.vanity.ts`/`sticker.vanity.ts`). Don't hand-roll this
per command; three copies of the same three-line conversion was the signal
it needed to be shared.

**The nav row itself** (prev/next, plus first/last when there's more than
one page to skip) is `pageNavRow(handler, arg, page, hasNext, totalPages)`
(also in `messaging.ts`) — returns a single `ButtonSpec[]` row, `[]` if
there's nothing to show. `pageWorker` (`worker.ts`) needs the same layout
logic but builds raw `callbackData` strings instead of going through
`reply()`'s `resolveButton`, so it calls the lower-level `pageNavSteps(page,
hasNext, totalPages)` (returns `{text, page}[]`) and maps that itself. Both
a command's `execute()` (page 0) and every subsequent `pageWorker` render
must go through one of these two — first/last only appearing after the
first click (not on the initial render) was exactly the bug caused by each
command hand-building its own page-0 row instead.

### A `@Page` handler doesn't have to belong to the command that uses it

`@Page`/`@QuickView` names are resolved in a **global** registry
(`findPage`/`findQuickView` in `loader.ts`), not scoped to the declaring
class. `/bg` and `/sticker` share one `'vanities'` `@Page` handler (declared
once, in `bg.vanity.ts`) and one `'equip'` `@QuickView` handler (declared
once, in `comprar.vanity.ts`) — both resolve their target type/item from
`arg` itself, so one handler legitimately covers multiple commands. Check
whether an existing handler already covers your case before declaring a new
one with the same shape.

## Buttons that start a fresh command: `runCommand` / `cmd:`

`@QuickView`/`@Page` answer in place; neither can *start* a new DBOS
workflow (they're deliberately stateless — no `DBOS.startWorkflow` inside
either worker). For a button that should behave exactly like the clicker
typed a command (e.g. a "Buy" button opening the confirm flow of an
independent purchase workflow), use:

```ts
buttons: [{ text: '💸 Comprar', runCommand: { name: 'comprar', args: [String(itemId)] } }]
```

`reply()` encodes this as `cmd:{name}:{args.join(',')}` (args must not
contain commas). `packages/common/inbound/callback.ts`'s `cmd:` branch synthesizes an
`IncomingCommand`/`Message` from the callback's author/chat info and pushes
it straight onto the normal `commandQueue` — from there it's indistinguishable
from a typed command, guards included. This means a workflow reachable via a
button has **exactly one implementation**, reachable two ways, rather than a
duplicate "button version" of the same flow to keep in sync.

## Purchase-flow pattern (`/comprar`, DBOS workflow)

- **`UsersDB.spendCoins(userId, amount)`**: a single
  `UPDATE ... WHERE coins >= amount`, not a separate balance read then a
  write — avoids a race between two concurrent spends both passing a stale
  balance check. Returns `false` on insufficient funds; the workflow checks
  this *after* the confirm button, not before showing it (balance can change
  between showing the confirm screen and the click).
- **Double-purchase race**: same TOCTOU class as the `store_items` lesson
  above — `bought_items` has `unique(userId, itemId)`; the workflow catches
  `23505` from the insert and refunds via `UsersDB.addCoins` if it lost the
  race, rather than trusting an app-level "already owned?" check alone.
- **Ditto purchase preview**: `generateProfileImage(data, overlays)` takes an
  optional second arg — pass `['preview']` to get a watermarked render, used
  on the confirm screen so a not-yet-purchased item's preview can't be
  mistaken for the real equipped state. Reuses `buildProfileData`'s
  `overrides` (already built for `/addbg`/`/addsticker`'s creation preview)
  to swap in the *candidate* item's URL without touching the DB.
- Equip is deliberately **not** part of the purchase workflow — it's a
  separate, instant `@QuickView` (see above), offered as a follow-up button
  after a successful purchase, or from `/bg`/`/sticker`'s item view for
  anything already owned.

## Storage & images

- `packages/commandeer/services/storage.ts` — `Bun.S3Client` (not
  `@aws-sdk/client-s3`, removed on purpose). `uploadBytes(bytes, keyPrefix,
  ext, contentType)` and `uploadFromUrl(sourceUrl, keyPrefix)`.
- **Telegram's file URLs lie about content-type** (`application/octet-stream`
  for real jpegs). `uploadFromUrl`'s `guessImageType()` only trusts a real
  `image/*`/`video/*` header; otherwise it sniffs the extension from the
  source URL path. Don't re-trust `res.headers.get('content-type')` blindly
  if you write a new upload path.
- **Card images specifically** need cropping (900×1260, real trading-card
  5:7 ratio) — use `packages/commandeer/services/cardImage.ts`'s
  `uploadCardImage(sourceUrl)`, not raw `uploadFromUrl`. It uses `sharp` for
  the actual crop-to-fill (`Bun.Image` has no crop/`cover` fit mode as of
  this writing — checked, not assumed) then re-encodes webp itself; don't
  route the output through `Bun.Image` afterward, that's a wasted
  decode/re-encode.
- **Animated sources** (GIFs, arrive as Telegram `animation`, not `photo` —
  see `Message.isAnimatedPhoto` set in `packages/telegram-inbound/index.ts`) must
  **skip** the crop pipeline entirely — `uploadFromUrl` directly, not
  `uploadCardImage`. See the `isAnimated` branch in `addcard.admin.ts`.
- Bucket layout: flat top-level folders per asset kind (`cards/`,
  `backgrounds/`, `stickers/`, `categories/`, `subcategories/`) — pass the
  right `keyPrefix`, don't nest.
- Category/subcategory **cover images** exist:
  `categories.drawImageUrl`, `subcategories.imageUrl` (both nullable). Set
  via `/addimgcat`/`/addimgclc`; displayed via `/cat`/`/clc`'s `photoUrl`.
  Don't forget these when porting anything that lists categories/subs.

## AI inference (Groq)

`packages/commandeer/services/cardInference.ts` — `groq-sdk`, JSON-mode
completion. **No OpenAI, ever** (explicit project decision). Pass live DB
state (category names, rarity names) into the prompt as context rather than
hardcoding — see `inferCardData`'s system prompt building from
`CardsDB.getCategories()`/`getRarities()`.

## Audit logging (replaces old bot's `reportWithContext`)

Old bot posted a moderation-channel message on every staff mutation. This bot
doesn't have that channel — instead: `AuditDB.log(userId, action, metadata)`
(`packages/database/audit.ts`), `action` as `'{noun}.{verb}'` (`card.create`,
`category.imageUpdate`, `vanity.background.create`). Every `add*`/`addimg*`
staff command does this — do it for every new one too, don't skip it.

## Database layer conventions

- One `*DB` class per domain (`CardsDB`, `UsersDB`, `VanitiesDB`, `AuditDB`)
  in `packages/database/{name}.ts`. Methods are **not** `@dataSource.transaction()`-decorated
  methods anymore — they're static fields built with `maybeTransaction()`
  (`packages/database/decorators.ts`):
  ```ts
  static getCategory = maybeTransaction('getCategory', async (client, id: number) => {
    return await client.select().from(categories).where(eq(categories.id, id)).limit(1).then(a => a?.[0]);
  })
  ```
  `client` is injected automatically — `dataSource.client` (a real DBOS-durable
  transaction) when `DBOS.isInitialized()` is true (the bot process, which
  calls `DBOS.launch()` at startup), or the plain `db` export otherwise (no
  DBOS bootstrap needed at all). Callers never see or pass `client` -
  `CardsDB.getCategory(id)` works identically in both cases. This exists
  because `dataSource.client` is hard-gated by the DBOS SDK (`DrizzleDataSource`'s
  `client` getter throws outside an active DBOS transaction, confirmed by
  reading the SDK source, not assumed) — a plain script, a test, or a future
  tRPC server calling `packages/database` directly would previously crash with
  `DBOS.launch() must be called before running transactions`. Verified both
  paths live: a bare script with zero DBOS calls, and a real
  `DBOS.launch()`/`DBOS.shutdown()` round trip, both return correct data.
  **Do not use `@dataSource.transaction()` for new methods** - use
  `maybeTransaction()`, matching every existing method.
- **`maybeTransaction()`'s non-DBOS fallback is a real transaction too, not just "no
  DBOS bootstrap needed."** Outside `DBOS.isInitialized()` (a plain script, a `bun
  test`), it wraps the call in `db.transaction(...)`, so a multi-statement method
  (e.g. `CardsDB.executeTrade`) still rolls back atomically on throw. This was *not*
  true before `/trade` needed it — the fallback used to call `fn(db, ...)` directly
  against the ambient, non-transactional client, so every existing multi-statement
  `maybeTransaction` method (e.g. `purchaseItem`) was silently non-atomic outside
  DBOS, just untested because nothing had exercised that path with more than one
  statement. Fixed once in `decorators.ts`, not per-caller. A money-path method with
  more than one statement should have a `bun:test` exercising the rollback case
  directly against the dev DB (see `cards.test.ts`) — that's what caught this.
- Why not a real `@decorator`: TS's legacy/experimental decorators (this repo
  uses `experimentalDecorators`, matching `@dataSource.transaction()`'s own
  style) can't reshape a method's *declared* type, so a decorator can't hide
  the injected `client` param from the caller-facing signature. A generic
  wrapping function can (and does, via `Args`/`Return` inference) - that's why
  `maybeTransaction` is a function you assign to a static field, not a
  `@maybeTransaction()` annotation.
- Prefer a single joined query over N+1 — e.g.
  `getCardsInSubcategoryForUser(subcategoryId, userId)` does one query with a
  `LEFT JOIN userCards` scoped to that user, instead of querying ownership
  per-card in a loop.
- Case-insensitive name search: `ilike(column, `%${query}%`)` from
  `drizzle-orm`, e.g. `searchCardsByName`/`searchSubcategoriesByName`. There's
  no full-text-search index in this schema (old bot had Postgres FTS) — ILIKE
  is the accepted honest MVP, don't build FTS just to match old behavior.
- `getOrCreateX(name, ...)` pattern for anything the AI or a staffer might
  reference by a not-yet-existing name (categories, subcategories).
- Duplicate-name checks that matter should have a **DB-level unique
  constraint**, not just an app-level check-then-insert (that's a TOCTOU
  race). See `store_items`' `unique(title, type)` — added after finding this
  gap in `/addbg`/`/addsticker`. `drizzle-kit push`'s interactive "truncate
  table?" prompt can't run non-interactively; apply such constraints via a
  one-off raw `ALTER TABLE ... ADD CONSTRAINT` after confirming no existing
  duplicate rows, then re-run `push` to confirm it's in sync.

## Constants & formatting

`packages/commandeer/constants.ts` — `EMOJI` map (shared icons: category,
subcategory, tag, owner, quickView, search, dice, page, browse, ...) and
`cativeiroEmoji(count)` (9-tier ownership-streak badge, ported verbatim from
old bot's thresholds). **Rarity emoji comes from the DB** (`rarities.emoji`
column) — never hardcode a rarity→emoji map like the old bot's `MEDAL_MAP`
did; this schema supports arbitrary rarities even though only the same 3
(Comum/Raro/Lendário) exist today, confirmed against the live DB — don't
assume a 4th rarity exists anywhere in this codebase's docs or code.

All replies are **Markdown** (`**bold**`, `` `code` ``, `_italic_`), not the
old bot's HTML (`<b>`, `<code>`, `<i>`) — `processMarkdown()` in
`packages/answerer/platforms/telegram.ts` converts it. Don't write HTML tags
into a reply string.

## Telegram-specific gotchas already handled

- **Group `@mention` targeting** (`/album@otherbot`): stripped/filtered in
  `packages/telegram-inbound/index.ts`'s `stripBotMention()`, reading
  `tg.user.username`. If the mention doesn't match our bot, the message is
  dropped before it ever reaches a queue. This only applies to Telegram —
  don't add it to `handler.ts` (platform-agnostic).
- **`photo` vs `animation` vs `document`**: a message's `photo` field is
  multiple *resolutions of one photo* (smallest-first; grab the largest), not
  multiple distinct photos — Telegram albums arrive as separate message
  updates, each with its own single `photo`. GIFs are a wholly separate
  `animation` field. An image sent as an **uncompressed file** (to dodge
  Telegram's photo compression — the normal way admins attach card/vanity
  art) arrives as `document` instead, resolved only when
  `document.mimeType` starts with `image/`. See `resolveMedia()` in
  `packages/telegram-inbound/index.ts`; all three feed the same `Message.photoUrl`, so no
  command needs to care which one it was.
- **Telegram never includes a profile photo URL on inbound updates** — a
  user's `avatarUrl` has to be fetched separately (`tg.getUserProfilePhotos()`)
  and is only worth doing occasionally, not on every message.
  `packages/telegram-inbound/index.ts`'s `refreshAvatarIfStale()` runs on
  every inbound message and callback query, refreshing at most once per
  24h per user (`avatarUpdatedAt`). **Anything that needs a real avatar URL
  must go through a user who's actually messaged/clicked something recently**
  — a brand-new user's row starts with `avatarUrl: ''` until their first
  inbound event. This bit `/trade`'s Ditto image generation directly: an
  empty `avatarURL` string makes Ditto's builder fail outright (confirmed via
  direct API testing, not assumed), and unlike a missing card image (which
  just renders with fewer cards), there's no silent-degradation path for a
  missing avatar — hence the refresh living in the platform-ingestion layer,
  not scattered into every command that happens to need an avatar.
- **Reply retries**: every queued response (`packages/common/dbos/messaging.ts`'s
  `RESPONSE_JOB_OPTIONS`) retries 3x with exponential backoff — transient
  network blips talking to Telegram used to silently drop replies with zero
  retry; don't bypass this by calling `responseQueue.add` directly without
  passing job options.
- **`reply_parameters` silently dropped on `sendPhoto`/`sendAnimation`**:
  `telegramsjs` routes any payload containing a media key (`photo`/
  `animation`/etc, even when the value is just a URL string, not a real file)
  through multipart form-data encoding instead of plain JSON. Its encoder
  only `JSON.stringify`s a small hardcoded allowlist of fields
  (`reply_markup`, `mask_position`, ...) before writing them as form parts —
  `reply_parameters` isn't on that list, so a raw object falls through every
  branch of its field-serializer as a no-op and never gets attached. Net
  effect: every `sendPhoto`/`sendAnimation` reply silently lost its
  "replying to X" link while `sendMessage` (plain JSON body, no such
  restriction) worked fine — this is why it looked like a `commandeer`
  reply-targeting bug at first when it was actually purely an `answerer`/
  library serialization issue. Fixed in
  `packages/answerer/platforms/telegram.ts`'s `buildReplyParameters()`: for
  `sendPhoto`/`sendAnimation` specifically, pass `reply_parameters` as an
  already-`JSON.stringify`'d string (which the multipart path *does* pass
  through correctly, as a plain form field); `sendMessage`/`editMessage*`
  keep the raw object, since double-stringifying there would break the JSON
  body instead. **Same root cause bit a second time** for `editMessageMedia`
  specifically (see "Negotiation state..." above) — `telegramsjs`'s
  multipart auto-detection keys off field *names*, not payload shape, and
  its multipart serializer's field-by-field handling is incomplete/wrong for
  several of Telegram's actual parameter shapes. Treat any new `tg.*` call
  whose params include `media`/`photo`/`animation`/etc. as suspect until
  verified against the real HTTP response, not just "it compiled and didn't
  throw."

## Known, deliberate gaps (don't silently rebuild these)

Say these out loud when porting something that touches them — don't quietly
half-implement:

- Last.fm scrobble integration — no music-service integration exists.
- Per-user custom card image preferences — no schema for this.
- `/clc i` (image-forward mode, a distinct display mode from the normal list
  view) — deliberately deferred, not forgotten. (The `1-5` ownership/rarity
  filters *are* built — see `@Page`'s pageFilters section above.)
- Postgres full-text search — ILIKE is the accepted replacement everywhere.
- Media-group/album ingestion — each photo in an album is a separate
  Telegram update; there's no "one logical multi-photo message" concept to
  reconstruct, and nothing here has needed it yet.

## Missing-argument handling

Mostly superseded by `@CommandArgument` now (see above) — a type's own
not-found/disambiguation reply already covers "I don't know which one you
mean" for `CARD`/`CATEGORY`/`SUBCATEGORY`/`VANITY_ITEM`, and `nullable:
true` covers "no argument given" for the two shapes that actually differ:

- **Bare usage string, no fallback list** (`/card`, `/clc`, `/favcard`) —
  there's no sane bounded "show everything" list (could be hundreds/
  thousands of cards), so a missing/unresolved arg just isn't `nullable`
  and falls back to `info.usage`.
- **Default to a paginated browse-all view on no args** (`/bg`, `/sticker`,
  `/cat`) — the arg is `nullable: true`, and the command body checks
  `args.category`/`args.item` for `undefined` to decide "show the browse
  view" vs. "show this one specific thing." This was a hand-rolled
  convention before `@CommandArgument` existed; it's just what `nullable`
  means now.

## Porting checklist

1. Read the real old-bot file(s). Quote strings, don't paraphrase.
2. List every DB query the old command makes; check which already exist on
   the relevant `*DB` class before adding new ones.
3. Pick a tier: plain command / DBOS workflow / `@Page` pagination (see
   above) — default to the cheapest one that fits.
4. Declare a `@CommandArgument` spec for anything beyond a no-arg command
   (see above) instead of hand-parsing `ctx.args` — check whether an
   existing type already covers the lookup before reaching for `STRING`/
   `NUMBER` as a fallback.
5. Decide guard folder (`all` vs `isAdmin` vs a new guard) and aliases
   (include the old command name if you're renaming).
6. Reuse `EMOJI`/`cativeiroEmoji` from `constants.ts`; add new shared emoji
   there rather than inlining ad-hoc ones in the command file.
7. If it touches images: crop only if it's card art
   (`cardImage.ts`); otherwise `uploadFromUrl` raw. Skip crop for animated
   sources.
8. Staff mutation? Call `AuditDB.log`.
9. State explicitly, in your summary, what you dropped and why.
10. `bunx tsc --noEmit -p .` clean before calling it done.
