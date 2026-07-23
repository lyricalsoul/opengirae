# Start here

openGIRAÊ is a gacha-style card-collecting bot (Telegram + Discord) with
real money-like state: coins, owned cards, trades, purchases, promo-code
redemptions. It is **not** a toy project or a demo — it has real users
running real concurrent traffic against it right now. Treat every change
with that in mind: a bug here can duplicate someone's cards, let two people
spend the same coins, or corrupt another user's data, not just print a
wrong message.

Read the rest of `docs/agent/` in order (`01-setup.md` onward) before
writing code. This file is just the fast-orientation pass: what kind of
system this is, the bug classes that actually happen here, and what "safe"
means for a new feature before you ship it.

**Keep this collection current.** If your change adds a package, a queue, a
new command pattern, a footgun worth warning the next agent about, or fixes
a bug whose old workaround these docs still describe as necessary, update
the relevant file as part of that same change — not as a follow-up someone
else does later. Unlike `PORT.md` (a porting checklist that was fine to let
go stale once porting itself was done), this collection describes how the
system works *now* — it doesn't have a natural end point where staying
current stops mattering, so there's no equivalent "we're done, it can drift"
moment for it.

## What kind of system this is

- **Multiple worker processes, no shared memory.** `telegram-inbound`,
  `discord-inbounder`, `commandeer`, and `answerer` are separate processes
  that only talk to each other through BullMQ queues (Redis-backed). Nothing
  can assume another process's in-memory state — every handoff is a
  serialized job. See `02-architecture.md` for the full picture.
- **Durable execution via DBOS**, for flows that need to survive a process
  restart mid-flight. A `@DBOS.workflow()` can suspend for arbitrarily long
  waiting on a button click or a free-text reply (`DBOS.recv`), and — this
  is the part that surprises people — **DBOS replays a still-suspended
  workflow from the top on every process restart.** Any side-effecting call
  inside a workflow (sending a message, writing to the DB outside a proper
  `*DB` method) that isn't step-wrapped will **re-run** on that replay, not
  just resume — this has caused real, shipped bugs (duplicate messages
  resent on every dev-server restart) before it was fixed once, centrally,
  rather than per-callsite. See `04-dbos.md` for the mechanics and exactly
  which primitives already handle this for you.
- **Concurrent by default.** Multiple people draw cards, trade, and spend
  coins at the same time, against the same rows, constantly. Nothing about
  this system is single-user-at-a-time, and any code written as if it were
  will eventually be hit by that assumption being false.

## The bug class that actually bites this codebase: TOCTOU races

Time-of-check-to-time-of-use: code reads some state, decides something based
on it, then writes — and between the read and the write, another concurrent
request changed the same state. This has been the single most common real
bug class here. Concretely, in this codebase:

- **Spending currency**: never read a balance, check it, then write a new
  balance in a separate step — two concurrent spends can both pass the
  check against the same stale balance and both succeed, net-negative.
  `UsersDB.spendCoins` is the pattern to copy: a single
  `UPDATE ... SET coins = coins - $amount WHERE coins >= $amount`, returning
  whether a row was actually updated. The check and the write are the same
  atomic statement — there is no gap for a race to land in.
- **"Already exists" / "already owned" checks**: an app-level
  check-then-insert (`SELECT ... ; if not found, INSERT`) always has a race
  window. The fix is a **real DB-level unique constraint**, with the insert
  wrapped in a try/catch for the constraint-violation error code (Postgres
  `23505`) — see the purchase flow (`bought_items`' `unique(userId, itemId)`)
  and the store-item duplicate-name fix (`store_items`' `unique(title,
  type)`, added after finding the exact gap this section warns about). The
  constraint is the actual safety net; the pre-check (if you keep one at all)
  is just a nicer error message for the common case.
- **Claim/lock-before-acting flows** (two people clicking `/girar` for the
  same user at once, two trade actions racing): use an atomic
  Redis `SET ... NX` claim (see `girarClaim.ts`/`tradeLock.ts`), not a
  `GET`-then-`SET`. `GET`-then-`SET` has exactly the same TOCTOU shape as an
  app-level existence check, just in Redis instead of Postgres.
- **Cross-argument validation that matters for safety** (e.g. two IDs that
  must differ) still needs an explicit check in the command body even when
  each argument individually resolved fine — `@CommandArgument` guards only
  ever see their own value, never a sibling's.

**The general rule**: if an action needs to be "check something, then act on
it," push the check into the same atomic operation as the act (a
conditional `UPDATE`, a DB constraint, an atomic Redis claim) whenever the
thing being protected is scarce or user-visible (money, ownership, a
one-time claim). Don't trust a separate read-then-decide-then-write as
"probably fine because the window is small" — the window doesn't need to be
large for real concurrent traffic to hit it, and this codebase has already
shipped and then fixed more than one bug that came from exactly that
assumption.

## What "safe to ship" means for a new feature here

Beyond "it works when I tried it once":

- **No N+1 queries.** A loop that calls a `*DB` method once per item is a
  query-per-item under real load. Prefer one joined query
  (`LEFT JOIN userCards` scoped to a user, for example) over querying
  ownership/state per-card/per-user in a loop — see `03-commands.md`'s
  database conventions section. This isn't a micro-optimization concern:
  a command that's fine at 5 items in dev can meaningfully slow down or
  time out at real collection sizes.
- **No unbounded queries against a table that grows with usage** — a list
  endpoint (users, cards, any per-user collection) needs real server-side
  pagination (`limit`/`offset`, a `{rows, total}` shape), not "load
  everything and slice in memory," once the underlying table isn't a small,
  fixed catalog. Categories/rarities are fine to load in full (they're
  small and effectively static); users/cards/subcategories are not.
- **Every write path that touches money, ownership, or a one-time
  action goes through the TOCTOU discipline above**, not just "looked
  correct in a manual test."
- **A test exists** for the new/changed DB method and for the command's
  actual decision logic, not just a manual click-through — see
  `03-commands.md`'s testing section for exactly what "a test" means here
  and the traps to avoid (stale-mock leaks across test files, racing the
  reply queue).
- **State that must survive a restart uses a `*DB` method or DBOS's own
  durable primitives, not an in-memory variable** — every worker process
  restarts routinely in this environment (`--watch` in dev, deploys in
  prod), and DBOS's replay-on-restart behavior (above) means a workflow's
  own local variables are not a safe place to keep anything you need to
  persist across a suspend point either — durable state goes through
  `DBOS.recv`/Redis/the database, not a closure variable you're hoping
  survives.
- **Say out loud what you deliberately dropped or deferred**, in your
  summary, rather than silently half-building a feature that looks complete
  but is missing the concurrency-safety half of it. A feature that's
  honestly scoped down is fine; one that looks finished but has a live race
  in it is worse than not having built it.
