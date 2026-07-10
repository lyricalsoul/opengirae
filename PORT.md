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

## Status: what's left (surveyed, not yet built)

From a full pass over every remaining `neogirae/packages/commands/{admin,cards,misc,users,vanity}/**`
file not in the table above. Re-verify against the old file before starting
any of these — this is a snapshot, not a spec.

**Easy** (fits existing patterns, no new subsystem): `addalb` (addcard preset
wrapper), `setimage`/`setimagebg`/`setimagesticker` (reuse the storage
pipeline), `uploadurl`, `delbg`, `delsticker`, `delsubcategory`,
`transfercards`, `setapelido`, `giraeban` (needs `isBanned`+`banMessage`
columns, already exist on `users`), `eval` (needs a new `isDeveloper` guard),
`cts` (same `@Page` shape as `/clc`, no subcategory scoping), `rep`/`reputação`
(needs a daily-cooldown flag), `inventory`/`loja` (old versions are already
just stub/fallback text).

**Complicated** (real new work, no new subsystem): `editbg`/`editsticker`
(edit branch over `vanityWizard.ts`, same idea as `/editcard` over
`cardWizard.ts`), `delete`/`del`/`delcard` (new confirm-button DBOS workflow),
`doar` (coin/card gift with confirm buttons + cooldowns — **not** trading,
one-way, no negotiation), `chicoin` (shares `doar`'s coin-transfer path).
`catlock` (restrict which categories a group can draw from) — needs one new
per-group config table + one check in `/girar`; classified Complicated, not
Major, if you're fine with that scope.

**Major rework** (blocked on a subsystem that doesn't exist — say so, don't
half-build it): `trade`/`strade`/`htroca` (no trade system), `conectarconta`/
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
  aliases?, useWorkflow? }` and `static override async execute(ctx:
  IncomingCommand)`.
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
  subcommand name from `ctx.args` before calling the handler.

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
  or `{content, photoUrl?, editMessageId?, buttons?}`) or `InlineReplyOptions`
  (`{content, eventName, options, restricted, rows?, ...}` — the
  DBOS-`recv`-coupled button flow, only meaningful inside a workflow).
- Method (`sendMessage`/`sendPhoto`/`sendAnimation`/`editMessageText`/
  `editMessageCaption`) is picked automatically from `photoUrl`/
  `editMessageId`/animated-extension — callers never choose it.
- **GIFs**: Telegram rejects `sendPhoto` for gifs/videos — `isAnimatedMediaUrl()`
  sniffs the outgoing URL's extension (`.gif`/`.mp4`/`.webm`) and routes to
  `sendAnimation` instead, automatically, for every `photoUrl` you pass.
- `deleteMsg(ctx, messageId)`.
- `awaitTextReply(cmd, eventName)` — registers the sender's *next* plain
  (non-`/`) message to resume a workflow via `DBOS.recv<{value}>(eventName)`.
  Only useful inside a `@DBOS.workflow()`.
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
  `packages/inbounder/callback.ts`.

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
  return { content, photoUrl?, hasNext }  // or null if arg no longer resolves
}
```

- Callback data: `pg:{handler}:{page}:{authorId}:{arg}` — fully
  self-describing, no TTL, works indefinitely.
- `restricted: true` makes the `{pages}` worker drop clicks from anyone but
  `authorId` (silent no-op, matches the workflow buttons' convention — no
  "not for you" message). Set this whenever the page content is
  viewer-specific (e.g. `/clc`'s per-user ownership counts derive `authorId`
  as "the viewer" — safe *only* because `restricted: true` guarantees the
  clicker is always the original author).
- Trigger the first page directly from the command's own `execute()` by
  calling the same rendering function the `@Page` handler calls (see
  `cat.cards.ts`/`clc.cards.ts` — both have a shared `renderPage()` used by
  both `execute` and the decorated method, so there's exactly one place that
  builds the content string). Wire subsequent pages via
  `buttons: [{ text: 'Próxima ➡️', page: { handler, arg, page: 1 } }]`.
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
contain commas). `inbounder/callback.ts`'s `cmd:` branch synthesizes an
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
  see `Message.isAnimatedPhoto` set in `packages/inbounder/index.ts`) must
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
did; this schema already supports arbitrary rarities (a 4th, "Mítico", exists
that the old bot's 3-entry map couldn't express).

All replies are **Markdown** (`**bold**`, `` `code` ``, `_italic_`), not the
old bot's HTML (`<b>`, `<code>`, `<i>`) — `processMarkdown()` in
`packages/answerer/platforms/telegram.ts` converts it. Don't write HTML tags
into a reply string.

## Telegram-specific gotchas already handled

- **Group `@mention` targeting** (`/album@otherbot`): stripped/filtered in
  `packages/inbounder/index.ts`'s `stripBotMention()`, reading
  `tg.user.username`. If the mention doesn't match our bot, the message is
  dropped before it ever reaches a queue. This only applies to Telegram —
  don't add it to `handler.ts` (platform-agnostic).
- **`photo` vs `animation`**: a message's `photo` field is multiple
  *resolutions of one photo* (smallest-first; grab the largest), not
  multiple distinct photos — Telegram albums arrive as separate message
  updates, each with its own single `photo`. GIFs are a wholly separate
  `animation` field. See `resolveMedia()` in `inbounder/index.ts`.
- **Reply retries**: every queued response (`packages/common/dbos/messaging.ts`'s
  `RESPONSE_JOB_OPTIONS`) retries 3x with exponential backoff — transient
  network blips talking to Telegram used to silently drop replies with zero
  retry; don't bypass this by calling `responseQueue.add` directly without
  passing job options.

## Known, deliberate gaps (don't silently rebuild these)

Say these out loud when porting something that touches them — don't quietly
half-implement:

- Trade sessions (old `/card`'s "add to trade" buttons) — no trade system
  exists.
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

Default reflex is a bare `Uso: /foo <arg>` string, but if the command already
has a meaningful **bounded** fallback listing for "not found" (e.g. `/cat`'s
"category not found, here are all of them"), reuse that same fallback for
"no argument given" too — factor it into one shared function taking just a
header string, don't duplicate the list-building. Missing-arg and not-found
are the same underlying situation ("I don't know which one you mean") and
should render the same way. Only keep a bare usage string when there's no
sane bounded "show everything" list to fall back to (e.g. `/card`, `/clc`,
`/favcard` — could be hundreds/thousands of cards, not a meaningful default
listing) — `/bg`/`/sticker` already do this the other way, defaulting to
their paginated browse-all view on no args, which was there before this
convention was named.

## Porting checklist

1. Read the real old-bot file(s). Quote strings, don't paraphrase.
2. List every DB query the old command makes; check which already exist on
   the relevant `*DB` class before adding new ones.
3. Pick a tier: plain command / DBOS workflow / `@Page` pagination (see
   above) — default to the cheapest one that fits.
4. Decide guard folder (`all` vs `isAdmin` vs a new guard) and aliases
   (include the old command name if you're renaming).
5. Reuse `EMOJI`/`cativeiroEmoji` from `constants.ts`; add new shared emoji
   there rather than inlining ad-hoc ones in the command file.
6. If it touches images: crop only if it's card art
   (`cardImage.ts`); otherwise `uploadFromUrl` raw. Skip crop for animated
   sources.
7. Staff mutation? Call `AuditDB.log`.
8. State explicitly, in your summary, what you dropped and why.
9. `bunx tsc --noEmit -p .` clean before calling it done.
