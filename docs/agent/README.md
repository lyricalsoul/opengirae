# Agent docs

A self-contained collection of instructions for agents (or humans) writing
code on the openGIRAÊ bot. Read in order if you're new here; jump to a
specific file if you already know the codebase and need one detail.

0. [**00-overview.md**](./00-overview.md) — read this one first, always.
   What kind of system this is (real users, real concurrent traffic, not a
   toy), the TOCTOU/race bug class that actually bites this codebase, durable
   execution via DBOS, and what "safe to ship" means for a new feature here.
1. [**01-setup.md**](./01-setup.md) — get the bot running locally: Bun,
   Docker (Postgres + DragonflyDB), `.env`, migrations, `dev:all`, tests.
2. [**02-architecture.md**](./02-architecture.md) — the packages, the
   message flow between them, BullMQ queues, Redis usage, and the
   third-party services (all optional locally, all fail safe).
3. [**03-commands.md**](./03-commands.md) — how to write a new command:
   file anatomy, guards/aliases, `@CommandArgument`, `@QuickView`/`@Page`,
   database conventions, **testing conventions** (write tests for new DB
   methods and command branching, every time), and the bot's writing style.
4. [**04-dbos.md**](./04-dbos.md) — when a command needs a real DBOS
   workflow vs. staying plain vs. stateless pagination, the messaging API,
   multi-party button flows, and known DBOS/Telegram-library gotchas.
5. [**05-debugging.md**](./05-debugging.md) — the `investigate` script,
   logging conventions, known gotchas already handled (don't re-discover
   them), and how to recognize/fix test-suite pollution from a crashed run.

These docs assume nothing about prior porting history or any other
document in this repo — they should stand on their own.
