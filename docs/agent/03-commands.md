# Writing commands

## Anatomy

```
packages/commandeer/commands/<guards>/<name>.<category>.ts
```

- **Filename drives dispatch.** `<guards>` is the directory name, split on
  `+` into guard names (`all` = no guard, `isAdmin` = staff-only). `<name>`
  becomes the registered command name; `<category>` is free-form metadata
  only (`cards`, `users`, `vanity`, `admin`, `main`, `misc`) — doesn't affect
  routing. See `packages/commandeer/loader.ts`.
- Every command file `export default class X extends Command` (from
  `@girae/common/commands`), with:
  ```ts
  static override info = {
    name: 'wish',
    description: 'Mostra ou edita sua lista de desejos',
    usage: '/wish [id ou nome do card]',   // shown by /commands AND used as the
                                            // fallback "Uso: ..." reply on a
                                            // failed @CommandArgument resolution
    aliases: ['wishlist', 'wl'],           // optional
    useWorkflow: true,                     // optional, see 04-dbos.md
  }
  static override async execute(ctx: IncomingCommand, args?) { ... }
  ```
  Set `usage` on every command, not just ones with a literal `Uso:` string —
  it's the automatic fallback message.
- **Guards**: `packages/commandeer/services/guards.ts`. Currently only
  `isAdmin` is registered; an unregistered guard name (e.g. `all`) is a
  silent no-op. Add a new guard function there, not per-command. Note:
  `isAdmin` also auto-passes for one hardcoded staff group chat ID — check
  the guard's source before assuming every admin command requires
  `users.isAdmin`.
- **Aliases**: pick names that read naturally in Portuguese first (this bot's
  primary audience), with an English alias where it helps (`/wish` /
  `/wishlist`). Don't be shy about silly/casual aliases either — `/girar`'s
  alias list includes `mirar`, `sentar`, `gozar` alongside the sensible
  `rodar`/`draw`. Match the existing tone rather than defaulting to
  corporate-sounding names.
- **Subcommands**: `@Subcommand({ name, description, aliases?, isWorkflow? })`
  on a static method (see `profile.users.ts`'s `emo`/`edit`/`privacidade`).
  Dispatch strips the subcommand name from `ctx.args` before calling the
  handler. `@CommandArgument` stacks on a `@Subcommand` method exactly like
  it does on `execute`.

## `@CommandArgument`: declarative argument parsing

Declare the positional argument list once; resolved values arrive as a
second `args` param instead of the command re-parsing `ctx.args` itself:

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

(there's no generated type per spec — write the `args` annotation by hand,
matching whichever `*DB` method that type resolves through)

- **Types** (`CommandArgumentType`, `packages/common/commands/decorators.ts`):
  `NUMBER`, `STRING`, `HEX_COLOR` (normalizes to a leading `#`), `BOOLEAN`
  (`yes`/`sim`/`1`/`on`/`ativar` → `true`; `no`/`nao`/`não`/`0`/`off`/
  `desativar` → `false`, case-insensitive; anything else fails), `USER_MENTION`
  (reply-to always wins over a typed arg; else `@username` DB lookup or a raw
  numeric platform ID), `CARD` / `CATEGORY` / `SUBCATEGORY` (numeric → lookup
  by ID; else fuzzy `ilike` search with 0/1/N-result handling —
  disambiguation list on N), `VANITY_ITEM` (same ID-or-fuzzy-name shape, but
  needs a fixed `vanityType: 'background' | 'sticker'` on the spec since
  there's no single "any vanity item" lookup).
- **Only the last spec is greedy** (joins every remaining token) — and only
  for `STRING`/`CARD`/`CATEGORY`/`SUBCATEGORY`/`VANITY_ITEM`.
  `NUMBER`/`USER_MENTION`/`HEX_COLOR`/`BOOLEAN` always mean exactly one
  token. Every earlier spec eats exactly one token.
- **`nullable: true`** — a missing token resolves to `undefined` instead of
  failing. Use for "browse everything" defaults (`/cat` with no args) and
  "optional, default to self" args (`/profile [@user]`).
- **`guard?: (value, ctx) => boolean | string | Promise<...>`** — runs after
  a successful parse. `false` → generic usage fallback; a string → that
  specific message instead.
- **No cross-argument validation** — a guard only sees its own value.
  Cross-field checks (e.g. "these two IDs can't be equal") stay a manual
  check in the command body, right after both resolve.
- **Resolution failures reply exactly once**, then `execute`/`@Subcommand`
  is never called.
- **Not for `@QuickView`/`@Page`** — those take a single opaque `arg` string
  from a different dispatch path entirely (see below).
- Resolver: `packages/commandeer/services/commandArguments.ts`, split into a
  pure core (`parseCommandArguments` — safe/fast to unit test directly) and a
  thin shell (`resolveCommandArguments`) that sends the reply on failure.

## Stateless callbacks: `@QuickView` and `@Page`

Both registered per-command and resolved **globally by name** at load time
(a `@Page`/`@QuickView` name doesn't have to belong to the command that
triggers it — e.g. `/bg` and `/sticker` share one `'vanities'` `@Page`
handler). Neither touches DBOS or Redis workflow state — everything needed
to answer lives in the callback data string itself.

**`@QuickView({ name })`** — ephemeral alert popup, e.g.:

```ts
@QuickView({ name: 'cardinfo' })
static async cardinfo(arg: string, clickerUserId: string): Promise<string> { ... }
```

Trigger via `{ text: '🧁', quickView: { handler: 'cardinfo', arg: String(id) } }`
in a `MessageReply.buttons` entry. The handler can also mutate data (see
`equip` in `comprar.vanity.ts`) as long as the write is instant and
idempotent-safe — no confirm step, unlike a purchase.

**`@Page({ name, restricted? })`** — in-place pagination:

```ts
@Page({ name: 'cat', restricted: true })
static async catPage(arg: string, page: number, authorId: string) {
  return { content, photoUrl?, hasNext, totalPages? }  // or null if arg no longer resolves
}
```

Set `restricted: true` whenever the page content is viewer-specific (the
worker enforces it, showing a "not your action" alert on a mismatched
click instead of silently no-oping). Trigger page 0 directly from the
command's own `execute()` by calling the *same* `renderPage()` function the
`@Page` handler calls, and the same `pageNavRow()` helper — don't hand-build
page 0's button row separately.

Filters on top of pagination: `@girae/common/utilities/pageFilters`
(`parseFilterArg`/`buildFilterArg`/`applyFilters`/`filterAdviceText`/
`filterButtonsRow`) — see `clc.cards.ts` for the reference usage.

## Buttons that start a fresh command

```ts
buttons: [{ text: '💸 Comprar', runCommand: { name: 'comprar', args: [String(itemId)] } }]
```

Encoded as `cmd:{name}:{args.join(',')}` (args must not contain commas),
routed straight back through the normal command queue — guards included,
indistinguishable from the clicker having typed it. Use this instead of
duplicating a workflow's logic behind a "button version."

## Database layer conventions

- One `*DB` class per domain (`CardsDB`, `UsersDB`, `VanitiesDB`, `AuditDB`,
  `PromoDB`) in `packages/database/{name}.ts`. Methods are static fields
  built with `maybeTransaction()`, not `@decorator`-annotated methods:
  ```ts
  static getCategory = maybeTransaction('getCategory', async (client, id: number) => {
    return await client.select().from(categories).where(eq(categories.id, id)).limit(1).then(a => a?.[0]);
  })
  ```
  `client` is injected automatically (a DBOS-durable transaction inside a
  running workflow, or a plain/transactional fallback otherwise) — callers
  never see or pass it. **Use `maybeTransaction()` for every new method**,
  not a raw `db.select()`/`db.transaction()` call.
- **Exception**: a pure read with no atomicity requirement (e.g. reading a
  single global settings/singleton row) should be a *plain* function using
  `db` directly, not `maybeTransaction`-wrapped — if it's ever called from
  inside another already-`maybeTransaction`-wrapped method's body (which a
  shared read helper often is), wrapping it too would nest one transaction
  inside another, which isn't safe to rely on. See `EconomyDB.getState()`/
  `getInflationRate()` (`packages/database/economy.ts`) for the pattern:
  reads are plain, only the mutations (`setInflationRate`, etc.) are
  `maybeTransaction`-wrapped.
- The non-DBOS fallback is a real `db.transaction(...)`, not a bare client —
  a multi-statement method still rolls back atomically outside a workflow
  (e.g. in a test).
- Prefer one joined query over N+1 (e.g. a `LEFT JOIN userCards` scoped to a
  user instead of querying ownership per-card in a loop).
- Case-insensitive search: `ilike(column, \`%${query}%\`)`. No full-text
  search index exists — ILIKE is the accepted approach everywhere.
- `getOrCreateX(name, ...)` for anything referenced by a not-yet-existing
  name (categories, subcategories).
- Duplicate-name checks that matter need a **DB-level unique constraint**,
  not just an app-level check-then-insert (TOCTOU race).
- Reuse a shared helper across `*DB` classes when the same check appears in
  more than one command — e.g. `UsersDB.isViewable(viewerId, target)`
  (`target.id === viewerId || !target.privacyMode`) is the single source of
  truth for every "can this viewer see that user's stuff" check (`/profile`'s
  avatar, `/wish`, `/cards`' reply-to-view). Don't reimplement that
  condition inline in a new command.

## Testing: every new DB method and every command with real branching needs a test

This isn't optional polish — it's how regressions get caught before they
reach production, and how a later agent verifies a change actually works
instead of trusting a diff by eye.

- **New/changed `*DB` method → a `bun:test` file** next to the existing ones
  (`packages/database/tests/{domain}/methodName.test.ts`), asserting against
  the **real local Postgres** (see `01-setup.md`). No DB mocking layer exists
  in this codebase and none should be added — the whole point is exercising
  real SQL.
- **New command with any branching** (a guard, a privacy check, a
  found/not-found split, a toggle) → an E2E-style test that calls the
  command's `execute()` (or `@Subcommand` method) directly against real
  inserted rows, not just the underlying DB method in isolation — this is
  what actually proves the command's *decision logic* is wired correctly,
  since `@CommandArgument` resolution and the command body are separate
  layers that can each be individually correct but still wired together
  wrong.
- **Use the shared test harness (`@girae/tests`) for setup, always** — don't
  hand-roll a `db.insert(users).values(...)` + a matching `db.delete()` chain
  in `afterAll`, and don't hand-roll another local `IncomingCommand` builder.
  This used to be duplicated (with subtle variations) across nearly every
  test file in the repo:
  ```ts
  import { TestFixtures, fakeCtx } from "@girae/tests";

  describe("...", () => {
    const fx = new TestFixtures();
    let userId: number;

    beforeAll(async () => {
      userId = (await fx.user({ displayName: "Test X" })).id;
      const categoryId = (await fx.category({ name: "Test Category" })).id;
      const subcategoryId = (await fx.subcategory({ categoryId, name: "Test Sub" })).id;
      await fx.card({ name: "Test Card", subcategoryId }); // omit subcategoryId for a bare card
    });

    afterAll(() => fx.cleanup()); // reverse-creation-order teardown, automatic
  });
  ```
  - `fx.user()`/`fx.category()`/`fx.subcategory()`/`fx.card()`/`fx.storeItem()`
    each create through the **real** `UsersDB`/`CardsDB`/`VanitiesDB` method
    production code calls (`ensureUser`, `createCategory`, `createCard`, ...),
    not a raw insert that reimplements what that method already does — a test
    suite that recreates its own version of "how to create a user" drifts
    from prod behavior over time and stops actually proving anything. `card()`
    is the one exception: with no `subcategoryId`, it does a bare `cards`
    insert, since `createCard` requires a subcategory and plenty of tests
    don't care about one.
  - `fx.onCleanup(fn)` registers anything the built-in helpers don't cover
    (a join-table row, an unusual FK) — cleanup runs LIFO (most-recently-
    registered first), so register a safety-net delete for something that
    might still reference an earlier fixture *after* creating that later
    thing, not before, or it'll run in the wrong order relative to it.
  - `fakeCtx({ name, authorId, args?, platform?, replyToAuthorId?, workflowID? })`
    builds the synthetic `IncomingCommand` for calling a command's `execute()`
    directly — replaces every file's own `ctx()` function.
  - Need a fresh set of fixtures per-test rather than once for the whole
    file (e.g. a test that mutates/deletes its own fixtures, like a merge)?
    Instantiate `new TestFixtures()` inside `beforeEach` instead of once at
    the top of `describe`, and call `.cleanup()` in `afterEach`.
  - `anyRarityId()` (also from `@girae/tests`) returns (and caches) any
    existing rarity id — rarities are a small, static catalog, safe to reuse.
- **Reply content assertions are optional and can be skipped in favor of
  asserting the underlying decision** (e.g. `UsersDB.isViewable(...)`
  returning the right boolean for the same rows) when going through the real
  reply pipeline. Two options for a command that does call `reply()`:
  - `mockTelegram()` (`@girae/tests`) + `bootstrapCommandeerWorkers()` +
    calling `execute()` directly, checking DB state afterward — reliable,
    but **do not** try to assert on `mockTelegram()`'s captured message
    content by reading it immediately after `execute()` resolves. The reply
    goes through a real BullMQ round-trip and the captured-messages array
    can lag by a second or more even after the promise resolves — this
    genuinely bit a real test in this codebase and cost real debugging time
    chasing a phantom "flaky infra" issue before landing on the fix below.
  - Prefer asserting the same underlying guard/DB state the command checks,
    or `expect(promise).resolves.toBeUndefined()` to prove it didn't throw,
    rather than racing the reply queue.
  - **Never `mock.module()` a shared module** (like
    `@girae/common/dbos/messaging`) at the top of a test file expecting an
    `afterAll` to cleanly restore it — `bun test` shares one module registry
    across every file in a run, so the mock can leak into and permanently
    rebind another test file's imports before your restore ever runs. This
    is exactly what broke an unrelated promo-code test the first time it was
    tried here.
- **Sequence hygiene**: if a test deletes rows at the current max ID for a
  table (common when the DB already has other data), reset that table's
  identity sequence afterward (`setval(pg_get_serial_sequence(...), MAX(id))`)
  or a later insert can collide. If you hit
  `duplicate key value violates unique constraint` on a test that looks
  otherwise correct, check for orphaned rows from a previous crashed run
  before assuming your new code is at fault — see `05-debugging.md`.
- Run the whole suite (`bun test` from repo root) before calling a change
  done, not just the file(s) you touched — a shared module (guards, a `*DB`
  method, `messaging.ts`) can affect commands you didn't mean to touch.

## The bot's writing style

Every reply string in this codebase follows the same voice — match it
exactly, don't default to a generic/corporate tone:

- **Portuguese first, informal "você."** Casual contractions are fine
  (`"Vish..."`, `"Chega de..."`). English aliases exist alongside Portuguese
  ones, but reply text itself is Portuguese.
- **Markdown, not HTML.** `**bold**`, `` `code` ``, `_italic_` — never `<b>`/
  `<code>`/`<i>`. `processMarkdown()` in `packages/answerer/platforms/telegram.ts`
  handles the conversion to whatever Telegram needs.
- **Always `escapeMarkdown()` user-controlled text** (display names, bios,
  card names someone typed) before interpolating it into a reply — from
  `@girae/common/utilities/markdown`. Never skip this for a name/string that
  ultimately came from user input.
- **Emoji as structural markers, not decoration.** A leading emoji signals
  what kind of line it is: 🃏 a card, 💝/💔 wishlist add/remove, 🔒 a privacy
  block, 😅/😔 a soft/friendly error, ✅/❌ confirm/cancel, 🎲 a count, 📃 a
  page indicator. Reuse `EMOJI` (`packages/commandeer/constants.ts`) and
  `cativeiroEmoji(count)` rather than inventing new ad-hoc icons per command.
  Note: `cativeiroEmoji()` is a purely cosmetic tier badge (🏆/👑/.../✨) shown
  next to a duplicate-count, unrelated to the *cativeiro* customization
  feature (`/cativeiros`, `/upload`, `/emojicard`, `rarities.cativeiroThreshold`)
  described below — the two share a name but not a mechanism.
- **Errors are gentle, never terse.** "Não encontrei..." + a clarifying
  question ("Ele já usou a bot?", "Talvez você marcou a pessoa errada?"),
  not a bare "not found." A blocked action explains *why*, in the same
  friendly tone, e.g. `"Esse usuário ativou o modo privado e não é possível
  ver [x] dele. 🔒"` — not an HTTP-error-flavored refusal.
- **`mention(platform, userId, name)`** (`@girae/common/utilities/mention`)
  builds the platform-correct way to reference another user in running
  text — a Telegram deep-link markdown mention or a Discord `<@id>`. Use it
  instead of hand-building either format, and don't nest it inside another
  markdown link (`[mention(...)](...)`) — that breaks the markdown, since
  `mention()` itself already returns a link on Telegram.
- **Confirmation flows use ✅/❌ with `color: 'success' | 'danger'`**
  (Discord-only button coloring, ignored on Telegram) — see any
  `awaitMultiPartyChoice`/button-confirm command.

## Checklist for a new command

1. Pick the cheapest tier that fits: plain / DBOS workflow / `@Page`
   pagination — see `04-dbos.md`.
2. Check what already exists on the relevant `*DB` class before adding a
   query method. Grep first.
3. Declare a `@CommandArgument` spec for anything beyond a no-arg command —
   check whether an existing type already covers the lookup.
4. Pick a guard folder (`all` vs `isAdmin` vs a new guard) and aliases,
   matching the tone above.
5. Reuse `EMOJI`/`cativeiroEmoji` from `constants.ts`.
6. Write the DB-method test(s) and the command E2E test(s) — see "Testing"
   above. Don't treat this as optional.
7. Staff mutation? Call `AuditDB.log(userId, action, metadata)`,
   `action` as `'{noun}.{verb}'` (`card.create`, `category.imageUpdate`).
8. Does your command grant the user a card (a new draw mode, an admin gift
   command, ...)? Emit `cards:new` via `emitCardsNew`/`emitHook`
   (`packages/commandeer/hookLoader.ts`) right after the `*DB` call that
   incremented `userCards.count`, the same way `/girar`/`/girarauto`/`/trade`
   do — see `02-architecture.md`'s "Hooks" section. Don't hand-roll the
   cativeiro-threshold check inline; the existing hook already does it.
9. Does your command take cards away (a new discard mode, an admin removal
   command, ...)? Decrement `userCards.count` inside the same DB transaction
   that reads/writes the row, and if the row survives (`count > 0`) but drops
   below the card's rarity's `cativeiroThreshold`, null out
   `customEmoji`/`customMediaUrl`/`customMediaType` in that same transaction
   — see `CardsDB.discardUserCardsTx`/`executeTrade`'s `decrement()` for the
   pattern. This is deliberately *not* done via the `cards:new`-style hook
   system: it's an ownership invariant ("you can't keep a customization for
   a card you're no longer eligible for"), not a notification, so it belongs
   in the same atomic write as the decrement rather than a best-effort
   post-commit listener.
10. `bun test` clean, `bun run check` (in `website/`, if touched) clean.
