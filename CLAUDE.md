# Instructions for Claude

Before writing or reviewing any code in this repository, read
`docs/agent/` in order (`00-overview.md` through `05-debugging.md`). It's a
short, self-contained collection covering: what kind of system this is and
the concurrency/TOCTOU bug class that actually bites it, local setup,
architecture, how to write a command (including required testing and the
bot's writing style), DBOS usage, and debugging.

Don't paraphrase from memory of a prior session — re-read the actual files;
they get updated and a stale memory of them is worse than not having read
them at all.

## Keep `docs/agent/` current

If a change you make affects anything those docs describe — a new package,
a new queue, a changed command pattern, a new footgun worth warning the next
agent about, a fixed bug whose old workaround is now documented as still
needed — update the relevant file in the same change. Treat these docs as
part of the codebase, not separate documentation debt to defer. Don't add
speculative content for things that don't exist yet, and don't duplicate
detail across files — extend or correct the existing section instead of
bolting on a new one.
