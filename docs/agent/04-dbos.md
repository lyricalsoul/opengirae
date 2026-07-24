# DBOS: when and how to use it

DBOS gives durable, replayable workflow execution — a workflow function can
suspend waiting for an event (a button click, a free-text reply) and resume
correctly even if the process restarts in between. It's powerful and it's
not free: every side-effecting call inside one needs explicit step-wrapping,
and a poorly-scoped workflow inherits durability guarantees (and pitfalls)
a plain command doesn't need to think about at all.

## Three tiers — pick the cheapest one that fits

1. **Plain command** (`useWorkflow` unset/false). No interactivity beyond a
   single reply, or interactivity that's fully stateless (see tier 3). This
   is most commands.
2. **DBOS workflow** (`useWorkflow: true`, `@DBOS.workflow()` on `execute`).
   Only when the flow is genuinely stateful and needs to *block* waiting for
   an unpredictable next input across multiple steps — button clicks via
   `DBOS.recv`/`DBOS.send`, free-text capture via `awaitTextReply`.
3. **Stateless pagination** (`@Page` decorator, see `03-commands.md`). For
   "Next/Prev page" UIs where the full state needed to render any page fits
   in the callback data itself. **Never use DBOS for this.**

Rule of thumb: if you can compute the response from `(who clicked, what
arg, what page)` alone with a DB query, it's stateless. If the next step
depends on a chain of *previous answers* that can't be re-derived from
scratch, it's a workflow.

**A moderator-approval queue is stateless too, not a workflow**, even though
it "waits" for a click — the wait can legitimately last hours or days, and
`reply()`'s `InlineReplyOptions` button state (see below) has a hard 1-hour
Redis TTL, so a workflow parked on `DBOS.recv()` that long would have its
buttons silently stop working while the workflow itself is still technically
suspended forever. `/upload`'s cativeiro-customization review
(`packages/commandeer/commands/all/upload.cards.ts`) is the concrete
pattern: a real DB table (`cardCustomizationSubmissions`) holds a
`status: pending/approved/rejected`, its own row is the durable state (not a
workflow variable), and Approve/Reject are ordinary `@QuickView` handlers —
stateless, resolved by name, safe to click at any point in the future. Each
handler does one atomic conditional `UPDATE ... WHERE status = 'pending'`
(same shape as `UsersDB.spendCoins`) so a double-click or two staff racing
each other on the same submission just no-ops the second click, with no
message-editing needed (`qv:` callbacks don't carry a `messageId` to edit
anyway — see `02-architecture.md`).

## Scheduled workflows (cron)

For work that runs on a clock rather than in response to a user action —
resetting daily flags at midnight, decaying a resource hourly — DBOS has its
own cron-like scheduler, separate from BullMQ and separate from a plain
`setInterval` (which wouldn't survive a process restart or work correctly
with multiple replicas).

- **Jobs live in `packages/commandeer/cron.ts`**, as `@DBOS.workflow()`
  static methods on a plain `CronJobs` class:
  ```ts
  export class CronJobs {
    @DBOS.workflow()
    static async runMidnightReset(schedTime: Date) {
      await UsersDB.resetMidnightStats()
    }
  }
  ```
- **Registered once, at `commandeer` startup**, in `packages/commandeer/index.ts`,
  after `DBOS.launch()`:
  ```ts
  await DBOS.applySchedules([
    { scheduleName: 'daily-midnight-reset', workflowFn: CronJobs.runMidnightReset, schedule: '0 3 * * *' },
    { scheduleName: 'hourly-draw-decay', workflowFn: CronJobs.runHourlyDrawDecay, schedule: '0 * * * *' },
  ])
  ```
  `schedule` is a standard 5-field cron string, evaluated in the server's
  timezone (the existing jobs assume UTC — `runMidnightReset` fires at 3:00
  UTC, matching `/daily`'s own `getTimeUntilMidnight()` cutoff, not literal
  midnight). `scheduleName` must stay stable once shipped — DBOS uses it (not
  the function name) to track the schedule's own execution history.
- **Each scheduled run is a real DBOS workflow** — same replay/durability
  behavior as any other workflow (see above), and same rule: any
  side-effecting call inside one needs to go through a step-wrapped
  primitive or a `maybeTransaction`-backed `*DB` method, not a raw one-off
  side effect, or a missed/replayed run could double-apply.
- **Adding a new daily/hourly reset to an *existing* job is usually cheaper
  than adding a new scheduled job** — e.g. `/rep`'s once-per-day cooldown
  flag (`users.hasGivenRepToday`) piggybacks on the existing
  `runMidnightReset` → `UsersDB.resetMidnightStats()` job, reset in the same
  bulk `UPDATE` that already clears `hasGottenDaily`, instead of registering
  a second midnight schedule. Same reasoning for
  `EconomyDB.syncAllocations()` — called from inside the existing
  `runHourlyDrawDecay`, not a new `scheduleName`, since both already run
  hourly. Only reach for a genuinely new `scheduleName`/cron entry when the
  timing actually differs (a different time of day, a different frequency)
  from what already exists.
- **`resetMidnightStats()` (and any job shaped like it) updates every row in
  `users` with no per-user `WHERE` scoping** — correct for a real scheduled
  run, but means it should never be called from a test against a shared dev
  database (it would reset every other user's daily-streak/rep-cooldown
  state too). Test the underlying flag-setting method
  (`UsersDB.setRepGiven`, `UsersDB.setDailyGotten`) directly instead, and
  leave the bulk reset itself un-exercised in tests — see `03-commands.md`'s
  testing section.

## Messaging API (`packages/common/dbos/messaging.ts`)

- **`reply(ctx, content)`** — `content` is a plain `MessageReply` (string or
  `{content, photoUrl?, editMessageId?, buttons?, buttonRows?, captionOnly?}`)
  or `InlineReplyOptions` (`{content, eventName, options, restricted, rows?,
  ...}` — the DBOS-`recv`-coupled button flow, only meaningful inside a
  workflow). **Returns `Promise<string | undefined>`** — the sent/edited
  message's ID on success, `undefined` if the send ultimately failed after
  retries. This is a real capability: it's what lets a workflow track a
  message ID and edit that exact message later from a totally different
  event (e.g. a button click on a different message entirely).
- **Method selection**: no `photoUrl` → `sendMessage`/`editMessageText`.
  `photoUrl` + no `editMessageId` → `sendPhoto`/`sendAnimation` (new
  message). `photoUrl` + `editMessageId` → `editMessageMedia` **unless**
  `captionOnly: true` (then `editMessageCaption`) — pass `captionOnly: true`
  when re-editing a message that already has this *exact* photo and only the
  caption/buttons changed (an unchanged-URL `editMessageMedia` gets Telegram's
  "message is not modified" error).
- **GIFs**: `isAnimatedMediaUrl()` sniffs `.gif`/`.mp4`/`.webm` and routes to
  `sendAnimation` automatically for any `photoUrl`. This is soundless
  (Telegram's animation endpoint) — pass `isVideo: true` alongside `photoUrl`
  to force real `sendVideo` (with sound) instead, for any `.mp4`/`.webm` URL
  that's an actual video, not a gif. `isVideo` only affects the plain
  `MessageReply` object branch's new-message path (not `InlineReplyOptions`,
  not an `editMessageId` edit) — extend it there first if a future caller
  needs one of those.
- A permanently failed send does **not** throw into the calling workflow —
  `settleReply()` catches and logs it, returning `undefined`. A workflow
  crashing because one platform send failed would be worse than a silently
  dropped reply.
- **Posting a brand-new message into a specific forum topic**: set
  `chat.threadId` on the `ctx` you `reply()` with (`buildCtx`/`sideCtx` from
  `packages/commandeer/services/syntheticCtx.ts` both take a `threadId`
  param) — `reply()` threads it into `PendingResponse.threadId`, and the
  answerer passes it as `messageThreadId` to `sendMessage`/`sendPhoto`/
  `sendAnimation`/`sendVideo`. **This only matters for a genuinely new
  message** — editing/deleting an existing message never needs it (the
  message already belongs to whichever topic it was sent in), and replying
  to a message that's already inside a topic gets the topic for free from
  Telegram's own `reply_to_message` inference, without needing `threadId` at
  all. Before this existed, nothing sent by the bot from a synthetic ctx
  (`buildCtx`, no real message to reply to) could ever land anywhere but a
  chat's default/General topic, silently — worth checking first if a
  bot-initiated message into a specific topic seems to be landing in the
  wrong place.
- `deleteMsg(ctx, messageId)`.
- `awaitTextReply(cmd, eventName)` — registers the sender's *next* plain
  (non-`/`) message to resume a workflow via `DBOS.recv<{value}>(eventName)`.
  Only useful inside a workflow. The same `eventName` can be reused across
  loop iterations.
- **`reply`/`deleteMsg`/`awaitTextReply` are DBOS steps** (via a
  `maybeStep()` wrapper — same dual-mode shape as `maybeTransaction`,
  `DBOS.isWithinWorkflow()` instead of `DBOS.isInitialized()`). This matters:
  `DBOS.launch()` replays any workflow still suspended on a `DBOS.recv()`
  (e.g. an abandoned wizard) on every process start. Without step-wrapping, a
  replay has no record these side-effecting calls already ran, and
  **resends every message the workflow sent so far**. Any new
  side-effecting call added inside a workflow needs the same treatment.
- **Button rows**: `InlineReplyOptions.rows?: number[]` lays `options` out
  into rows by size (e.g. `[4, 4, 1, 1]`); omit for one flat row.

## Workflow button/text flow pattern

```ts
@DBOS.workflow()
static override async execute(ctx: IncomingCommand) {
  await reply(ctx, { content, eventName: 'foo', restricted: 'author', options })
  const selection = await DBOS.recv<{ value: T, messageId?: string }>('foo')
  // ...loop, re-`reply()` with `editMessageId: messageId` to update in place...
}
```

- `reply()`'s `InlineReplyOptions` branch stores a `StoredStep` in a Redis
  hash `workflow:{workflowID}` — **1h TTL, the flow silently dies after an
  hour.** Fine for "confirm this add," wrong for anything meant to stay
  usable indefinitely.
- `restricted: 'author'` limits clicks to the original sender, enforced in
  `packages/common/inbound/callback.ts`. The pending event's Redis hash
  field must be deleted *after* the restriction/option checks pass, not
  before — deleting first means an invalid click permanently destroys the
  event and the real author's later click silently no-ops forever, even
  though the buttons are still visibly there.

## Multi-party flows: `awaitMultiPartyChoice`

For flows with more than one legitimate clicker where you need to know
*which* of them clicked and whether *this* click is currently valid (not
just "is this click from an allowed person"):

```ts
awaitMultiPartyChoice<T>(cmd, eventName, content, options, authorIds, isValid, timeoutSeconds?)
```

Posts the buttons (`multiUse: true` under the hood — an invalid click is
simply ignored, buttons stay live, instead of a single-consumer flow where
*any* authorized click permanently destroys the event even if it was the
wrong role/stale state), loops `DBOS.recv` until a click satisfies
`isValid(choice)`, and returns `{data, clickerUserId, messageId}` (or `null`
on timeout). `isValid` can carry its own mutable state across calls (e.g.
accumulating two separate "I'm done" clicks before resolving). Reach for
this instead of hand-rolling the loop for any two-or-more-party confirm.

## Real platform DMs, without a "send to anyone" primitive

There's no "send a DM to an arbitrary user" function, deliberately — Telegram
forbids a bot from messaging a user who hasn't messaged it first, so such a
primitive would just fail silently anyway. Instead:

1. Post a **URL button** to `https://t.me/{botUsername}?start=<payload>`
   (`getBotUsername()`, `packages/commandeer/services/botInfo.ts`).
2. Clicking it opens a private chat and sends `/start <payload>` **as that
   user** — this is what legitimizes everything after. `start.main.ts`
   dispatches on the payload; extend it for a new deep-link need rather than
   creating a second `/start`-like command.
3. From inside a running workflow that only knows the *original* chat,
   message into the newly-opened private chat by building a shallow
   override of the `IncomingCommand` (same `workflowIDToBeAssigned`, swapped
   `message.chat`/`message.author`) and calling ordinary `reply()` with it —
   no messaging-layer changes needed, since button-click routing is keyed by
   workflow ID, not chat.

`reply()`'s returned message ID (above) is what lets a view be re-edited in
place later even when the trigger is a completely different message's
button — track the returned ID in Redis state per side, like `/trade` does,
rather than sending a fresh message every time.

## Negotiation state for multi-step, multi-party flows: Redis, not workflow closures

When actions arrive via a `@QuickView`/`@Page` triggered from a *different*
command or message than the one the workflow is currently blocked
rendering, that handler has no access to the running workflow's local
variables — it's resolved globally by name and runs as a stateless request
handler. So negotiation state (both sides' offers, ready flags, which DM is
open) lives in Redis (`trade:state:{workflowID}`, JSON, TTL-refreshed on
every write), not in the workflow function's closure. The `@QuickView`
handlers validate and mutate that state directly, then ping the workflow's
`DBOS.recv` loop, which just re-reads current state and re-renders — it
doesn't own or duplicate the mutation logic. Reach for this shape whenever a
workflow needs to react to actions that don't arrive as a click on a message
it's itself holding open.

## Shared wizards: when two commands need (almost) the same workflow

Extract the loop into a plain function under `packages/commandeer/services/`
in the matching domain subfolder (see `02-architecture.md`'s "`services/`
layout"), parameterized by a `mode` (and whatever else differs), rather than
duplicating the loop or cramming both flows into one file — e.g.
`services/cards/cardWizard.ts`'s `runCardWizard(ctx, { cardData, photoUrl,
mode: 'create' | 'edit', existingCardId? })`, shared by `/addcard`/`/editcard`.
Only the commit step branches on `mode`; each command file becomes "resolve
my mode-specific inputs, then call the shared wizard."

## Common gotchas

- **`telegramsjs`'s `editMessageMedia` wrapper is broken for URL-based
  media** — its request builder switches to multipart form-encoding whenever
  a payload has a top-level `media` key (checked by field *name*, not
  shape), and its multipart serializer can't handle `editMessageMedia`'s
  nested `{type, media, caption}` shape (unlike `sendPhoto`'s bare-string
  `photo`). `packages/answerer/platforms/telegram.ts`'s `editMessageMediaRaw()`
  bypasses the library and calls the HTTP API directly instead. Don't route
  `editMessageMedia` back through the library without re-verifying this
  against a real HTTP response, not just "it compiled."
- **`reply_parameters` silently dropped on `sendPhoto`/`sendAnimation`** —
  same multipart-detection issue; only a small hardcoded field allowlist
  gets serialized. Fixed via `buildReplyParameters()` passing an already-
  `JSON.stringify`'d string for those two methods specifically (which the
  multipart path does pass through correctly as a plain form field) while
  `sendMessage`/`editMessage*` keep the raw object. Treat any new `tg.*` call
  whose params include a media-shaped key as suspect until verified against
  a real response.
- **Always attach a fallback image rather than omitting one on a Ditto
  failure**, if the flow's first render needs to guarantee a photo message
  (not a text message) — see `/trade`'s `FALLBACK_TRADE_IMAGE`. Converting a
  text message to a photo message later via `editMessageMedia` does work,
  but it's simpler to never need to.
- **A real (sound-having) video sent via `sendAnimation` fails with two
  different Bad Request messages across retries** — "failed to get HTTP URL
  content" on the first attempt (Telegram hasn't fetched it yet), then
  "wrong type of the web page content" once it has and rejected the actual
  content (`sendAnimation` only accepts silent GIF-style video). This can
  happen even when `isVideo` was correctly threaded through if the inbound
  classification upstream got it wrong. `sendAnimation`'s case in
  `packages/answerer/platforms/telegram.ts` catches both messages
  (`isRetriableAsVideo()`) and retries once via `sendVideo` before giving up
  — don't remove this without confirming inbound video classification is
  airtight first.
