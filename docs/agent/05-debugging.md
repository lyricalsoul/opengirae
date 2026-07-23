# Debugging

## The `investigate` script

```sh
bun run investigate <message id | chat id | telegram user id | workflow id>
```

(`packages/tests/scripts/investigate.ts`) — read-only, prints a single
merged, time-sorted timeline of every event matching that ID across:

- Every BullMQ queue (`commandQueue`, `responseQueue`, `resumeQueue`,
  `quickViewQueue`, `pageQueue`), across every job state (`waiting`,
  `active`, `completed`, `failed`, `delayed`, `paused`) — matches on job ID,
  `job.data`, or `job.returnvalue`.
- DBOS's own system tables (`dbos.workflow_status`, `dbos.operation_outputs`,
  `dbos.notifications`) via `DBOS_SYSTEM_DATABASE_URL` — matches on workflow
  UUID or a substring match against inputs/output/error/message.

This is the first thing to reach for when something *should* have happened
but didn't (a reply never arrived, a workflow seems stuck) — it tells you
whether the job/workflow ever existed, what state it's in, and what its
recorded input/output/error was, without needing to add temporary logging
and reproduce the issue again. Use a Telegram message ID, chat ID, user ID,
or a DBOS workflow UUID (visible in `commandeer`'s startup/recovery logs) as
the search term.

## Logging

`packages/common/logger.ts` — `info`/`warn`/`error`/`debug(namespace,
message)`, all just formatted `console.log`. No log level filtering, no
external log aggregation — everything prints to the process's stdout.
`debug()` is fine to add temporarily while diagnosing something live (see
"temporary logging" note below), but should be removed once the root cause
is found, not left in permanently.

**When adding temporary debug logging to trace a live issue**: log at the
boundary where you're uncertain what's actually happening, not everywhere.
For a "a command isn't behaving as if X" report, that's usually the
inbound-normalization layer (what did the platform actually send) and the
command's own branch point (which path did it take, and why) — not every
intermediate function call. Remove it once you've found the actual root
cause; don't leave speculative logging behind "just in case."

## Common gotchas already handled (don't re-discover these)

- **Group `@mention` targeting** (`/album@otherbot`) — stripped/filtered in
  `telegram-inbound/index.ts`'s `stripBotMention()`. A mention that doesn't
  match this bot's username drops the message before it reaches a queue.
  Telegram-only.
- **`photo` vs `animation` vs `document`** — a message's `photo` field is
  multiple *resolutions of one photo* (smallest-first; the largest is the
  one to use), not multiple distinct photos. GIFs arrive as a separate
  `animation` field. An image sent as an **uncompressed file** (the normal
  way admins attach card/vanity art, to dodge Telegram's photo compression)
  arrives as `document`, resolved only when `document.mimeType` starts with
  `image/`. See `resolveMedia()` in `telegram-inbound/index.ts` — all three
  feed the same `Message.photoUrl`, so command code never needs to care
  which one it was.
- **Telegram never includes a profile photo URL on inbound updates** — a
  user's avatar is fetched separately (`tg.getUserProfilePhotos()`) and
  throttled to once per 24h per user (`avatarUpdatedAt`) by
  `refreshAvatarIfStale()`, which runs on every inbound message/callback.
  **A brand-new user's row starts with `avatarUrl: ''`** until their first
  inbound event — anything that needs a real avatar URL (Ditto image
  generation, for instance) can fail outright for a user who's never
  actually messaged/clicked anything yet.
- **Reply-to-topic-anchor false negative**: Telegram auto-attaches
  `reply_to_message` pointing at a forum topic's own "X created the topic"
  service message for ordinary in-topic posts (so clients can tell which
  topic a plain post belongs to, even when the user didn't deliberately
  reply to anything). A naive "does the replied-to message's ID equal the
  topic's thread ID" check can't distinguish that synthetic case from a user
  *genuinely* replying to a message that happens to share that ID — which
  silently breaks any command relying on reply-to-imply-target (e.g.
  `/strade` sometimes claiming it "couldn't find" the person being replied
  to, even though the reply looked correct). The fix: only treat it as
  anchor noise when the replied-to message is actually the synthetic
  `forum_topic_created` service message (`telegramsjs` exposes this as
  `message.forumCreated`), never based on ID equality alone. See
  `packages/telegram-inbound/replyTo.ts`'s `buildReplyTo()` and its test —
  this is exactly the kind of bug that's easy to reintroduce by "simplifying"
  the check back to an ID comparison.
- **Reply retries**: every queued response (`RESPONSE_JOB_OPTIONS`) retries
  3x with exponential backoff. Don't bypass this by calling
  `responseQueue.add` directly without job options — transient network
  blips used to silently drop replies with zero retry before this existed.

## Test-suite pollution: stale rows from a crashed run

Since tests run against a real local Postgres (see `01-setup.md`,
`03-commands.md`), a test that crashes or gets killed mid-run before its
`afterAll` executes leaves orphaned rows behind. The next run (possibly
days later, possibly touching completely unrelated code) can then fail with:

```
error: duplicate key value violates unique constraint "categories_name_unique"
```

or similar, on a table your change never touched. Before assuming your code
introduced a regression:

1. Query for the specific offending name/value the error mentions (e.g.
   `SELECT * FROM categories WHERE name ILIKE 'Test Concurrency%'`).
2. If found and clearly a test fixture (matches a `beforeAll` in some
   `*.test.ts` file, not real data), delete it and any rows that reference
   it (check for a card/subcategory/user chain — same test's `beforeAll`
   usually shows you the full set to clean up, in insert order — delete in
   reverse).
3. **Reset the affected table's identity sequence** if the deleted row(s)
   were at or near the current max ID:
   ```sql
   SELECT setval(pg_get_serial_sequence('categories', 'id'), (SELECT MAX(id) FROM categories));
   ```
   Skipping this step is how the *next* insert can collide again even after
   cleanup — a `generatedAlwaysAsIdentity()` column doesn't know rows were
   deleted out from under it.
4. Re-run the full suite (`bun test`, not just the one file) to confirm it's
   actually clean, not just that one symptom.

If the test uses `TestFixtures` (`@girae/tests`, see `03-commands.md`),
`fx.cleanup()` logs which specific step failed (via `console.error`) instead
of aborting the rest of the teardown queue on the first error — check the
run's output for that message before manually hunting for orphaned rows;
it'll usually name the exact table/constraint that needs a look, and a
cleanup ordering bug (an `onCleanup()` registered before something that
later ends up referencing it) is the most common cause.

## When a test involving `reply()`/BullMQ feels flaky

See `03-commands.md`'s testing section — the short version: don't assert on
`mockTelegram()`'s captured message content immediately after a command's
`execute()` promise resolves (the real queue round-trip can lag), and never
`mock.module()` a shared module like `@girae/common/dbos/messaging` without
accounting for `bun test`'s single shared module registry across every file
in a run. Prefer asserting the same underlying decision/DB state the command
checks over racing the reply queue at all.
