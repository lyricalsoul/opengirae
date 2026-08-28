# Prod operations

Things that come up when asked to investigate or fix something against *live*
prod data, not local dev — connecting to the real Postgres/Dragonfly, undoing
an accidental card transfer, and detecting the recurring card-catalog
scraping attack. All of this is against real user data; read this whole file
before touching prod, not just the section that looks relevant.

## Connecting

Prod connection details aren't checked into this repo (correctly — get them
from whoever owns the deployment, not from here) and aren't the same as the
local docker Postgres/Redis `01-setup.md` describes. When given prod access:

- Confirm which environment a hostname actually points at before trusting its
  name — a host called "dev" has been repurposed as prod before here. Check
  row counts / recent activity, don't assume from the name.
- Prod's DBOS system database is a separate database on the same Postgres
  instance (not necessarily named `..._dbos_sys` the way local dev's is) —
  `\l` to find it, then `\dt dbos.*` for its tables. `workflow_status.name` is
  the command's registered workflow name (often just `"execute"`, not the
  command name), so match by `workflow_inputs`/`workflow_status.inputs`
  content (author/target platform IDs, command args), not by `name`.
- Treat every session as read-only until a specific write is confirmed. Query
  first, mutate only once you can point at the exact row(s) and have shown
  the plan to whoever asked.

## Reverting an accidental card transfer (`/doar`, `/trade`)

**The bot has admin commands for this now — try those before doing any of
this by hand.** `/doacoes @usuário [página]`
(`packages/commandeer/commands/admin/doacoes.ts`, `isAdmin`-guarded) lists a
user's donation history (10 per page, plain numeric page argument, not
button-based - see the comment in that file for why), each entry showing its
audit log `#id` and, if already reverted, who did it and when. Feed that id
to `/doacaocancelar <ID da doação>`
(`packages/commandeer/commands/admin/doacaocancelar.ts`) to actually revert
it. The admin panel's donation-history modal (`Ver histórico de doações` on
a user, `website/src/lib/components/DonationHistoryModal.svelte`) shows the
same thing read-only, if OIDC happens to be working wherever you are — but
`/doacoes` doesn't depend on that, so treat it as the primary way to find an
id. Neither surface can trigger a revert by itself, deliberately — see "Why
bot commands and not a website button" below.

The command calls `AuditDB.revertDonation` (`packages/database/audit.ts`),
which automates most of what this section used to require doing manually: it
claim-locks the audit log row (`revertedAt`/`revertedByAdminId`, so a
donation can't be reverted twice), takes back each donated card unit from the
recipient if they still have it, and — this is the part manual SQL can't
do — if they *don't* still have a given unit, it applies a fallback penalty
instead of just failing: takes one draw, then
`DONATION_REVERT_PENALTY_COINS` (1000) coins to the treasury, then one card
of the same rarity from the recipient's own collection, in that order. The
donor gets a copy of the originally-donated card back regardless of which
fallback paid for it. If every fallback is exhausted for even one unit, the
whole revert rolls back atomically (nothing partially changes) and the
command replies naming which card it couldn't cover — at that point you're
into genuinely manual territory, see below. This also means
`card.doar`/`card.doarclc` metadata now stores `cards: [{cardId, count}]`
(exact per-card quantity), not just distinct `cardIds` — the caveat below
only applies to rows logged before this shipped.

**Why bot commands and not a website button**: the admin panel
(`/admin`) authenticates staff via OIDC (`better-auth` + `genericOAuth`),
which has no local-dev bypass the way the Mini App's
`BYPASS_TELEGRAM_AUTH_DO_NOT_USE_THIS_IN_PROD_PRETTY_PLEASE` does — so a
website-triggered mutation here couldn't be tested end-to-end without a real
OIDC provider wired up. `AuditDB.revertDonation` took an admin's website
login (email) as the "who reverted this" identity at first; that got
reworked to take a bot `users.id` instead once the trigger moved to a
command, so `audit_logs.revertedByAdminId` is a real FK to `users` now, not
free text.

**Only `/doar`/`/doarclc` write an audit log entry** (`audit_logs.action =
'card.doar'`/`'card.doarclc'` — donor is `actorUserId`). `/trade`
(two-sided) does not audit-log at all today and has no revert button; if
asked to revert a `/trade`, you'll need to reconstruct it from DBOS
`workflow_inputs` (see below) since there's no audit trail to start from —
say so up front rather than assuming one exists.

**Discoteca (album/single) donations have the identical setup under a
separate namespace.** `/doardisco`/`/doarclcdisco` log
`discoteca.doar`/`discoteca.doarclc` (metadata: `{recipientUserId, entries:
[{entryId, count}], artistId?}` — `artistId` only on the `doarclcdisco`
"whole discography" case, the Discoteca analog of `subcategoryId`).
`/doacoesdisco @usuário [@usuário2 [página]]` and `/doacaocancelardisco <ID>`
(`packages/commandeer/commands/discoteca/doacoesdisco.ts`,
`doacaocancelardisco.ts`) are exact mirrors of `/doacoes`/`/doacaocancelar`,
backed by `AuditDB.getDiscotecaDonationHistory`/`revertDiscotecaDonation` —
same claim-lock, same draw→coins→same-rarity-item fallback chain (reusing
`UsersDB.tryConsumeDrawAsPenaltyWithClient`/`DONATION_REVERT_PENALTY_COINS`,
so the coin penalty amount and the draw pool are shared with card reverts).
The two systems are otherwise completely separate: a card donation's audit
log id and a Discoteca donation's audit log id can collide (auto-increment
across the whole `audit_logs` table) but `/doacaocancelar` and
`/doacaocancelardisco` each only ever match their own action names, so
feeding one command's id to the other just replies "not found," never
touches the wrong row.

**Caveat on legacy `card.doar` rows logged before per-card quantity
shipped**: their metadata only has `cardIds` — *distinct* card IDs, with
duplicates from a quantity >1 collapsed to one entry. `AuditDB.revertDonation`
treats each of those as a single unit (1x), which under-reverts a
quantity>1 donation from before this fix. It also silently drops any card
the donor didn't have enough of at confirm time (`doar.ts`'s `skippedIds`) —
those were never actually transferred, don't revert them. Neither the
count-per-card nor which requested IDs got skipped is recoverable from a
legacy audit log alone.

**To get exact per-card quantities for a legacy row**, cross-reference DBOS
`dbos.workflow_status.inputs` for the matching `execute`/`doar` workflow
(match by donor/recipient Telegram IDs from `linked_accounts` and a
timestamp close to the audit log's `createdAt` — the confirm-button click
lands a few seconds after the workflow starts). The raw command args (e.g.
`/doar 528 4 4 30 ...`) is the actual token list the user typed, duplicates
and all — count occurrences yourself, then subtract any ID that's in the
typed list but missing from the audit log's `cardIds` (that's a skipped one).

**When the command's fallback chain isn't what you want** — e.g. the
recipient shouldn't be penalized at all because the mistake wasn't theirs,
or you need to revert a legacy under-counted row exactly — fall back to a
manual reversal. Same checks as the automated path had to account for,
spelled out here because you're now doing them by hand:
1. Does the recipient still hold at least the quantity you intend to take
   back of every card? If they've since spent/re-traded some, decide
   consciously whether to under-revert or make the donor whole some other
   way — don't silently short-change either side.
2. Does either side have `customEmoji`/`customMediaUrl` set on the affected
   `user_cards` rows? If the recipient's count would need to be preserved
   above the card's `rarities.cativeiroThreshold` for the reversal not to
   clear their own customization on an *unrelated* higher-count card, check
   first — this mirrors `CardsDB.executeTrade`'s `decrement()` clearing logic
   (`docs/agent/02-architecture.md` doesn't cover this, see `cards.ts`).
3. Would giving the cards back complete a subcategory for the original owner
   that they hadn't already completed? `subcategoryCompletionRewards` has a
   unique `(userId, subcategoryId)` constraint, so a duplicate claim can't
   double-pay — but a *new* completion should pay out, and a raw hand-written
   reversal query won't fire that reward on its own. Check first: is there a
   subcategory where the owner would now hold every card, and it isn't
   already in `subcategoryCompletionRewards` for them? If none, a plain
   `user_cards` count swap is safe and complete.

**Write the reversal as raw SQL in one transaction** (this codebase's
convention for any prod write — no throwaway TS/JS scripts), mirroring what
`executeTrade` would have done: decrement the recipient's `count`, delete the
row if it hits 0, upsert (`INSERT ... ON CONFLICT DO UPDATE SET count =
user_cards.count + EXCLUDED.count`) the original owner's row back up. Back up
the affected `user_cards` rows (`\copy ... TO 'backup.csv' WITH CSV HEADER`)
before running it. Log the reversal itself to `audit_logs` (action
`card.doar.revert`, metadata pointing at the original audit log id — same
action name `AuditDB.revertDonation` itself uses, so it shows up
consistently either way) so there's a trail explaining why the counts moved
without a matching `/doar` in the bot's own command history. If you also
need to mark the original row so `/doacaocancelar` won't try to revert it
again, set `revertedAt`/`revertedByAdminId` on it in the same transaction —
`revertedByAdminId` is a real FK to `users.id`, so use whichever admin's row
is doing this manual fix, not a placeholder.

## Traffic/abuse analysis: card-catalog scraping

A recurring attack: an account scrapes the full card catalog (name/art/
rarity per card) to recreate it on a rival bot. Not a one-off — worth
recognizing the pattern on sight.

**Pattern**: `/clc` or `/col <subcategory>` (lists every card ID in a
subcategory in one reply — the harvesting step) followed by sequential
`/card <id>` calls for each ID from that list, a few seconds apart, to pull
name/art/rarity individually. Observed only in the attacker's own DM with the
bot, never a group. The account is usually a same-day burner: blank/placeholder
`displayName`, 0 coins, no real `card_draw_history`/`user_cards`/`audit_logs`
activity.

**Investigating**: bounded Dragonfly `commandQueue` traffic analysis — scope
scans by a binary-searched timestamp/id range, never a full-keyspace `SCAN`
(see `05-debugging.md`'s general Dragonfly guidance). Pull `name`,
`timestamp`, `author.id`, `chat.id`, `args` per job (a server-side Lua
`string.match` per field keeps a 10k+ job dump parseable), group by
`author.id`, and look for: high `/card` volume from one author; strictly
ascending integer args with small, consistent gaps (a script, not a human
browsing); a `/clc`/`/col` call shortly before a run of sequential `/card`
ids drawn from that subcategory. Cross-check the suspect `users.id` in
Postgres for the burner tells above.

**Retention caveat**: `commandQueue` only retains ~24h/10k completed jobs
going forward. An account's full history back to creation may not be
recoverable if it's more than a day old — investigate promptly when a
suspicious account is first spotted.

**Response**: prefer `users.obscureMode` over an outright ban. When set,
`/card` (`packages/commandeer/commands/cards/card.ts`) returns a fresh random
name and a placeholder image instead of the real card, for that viewer only —
the command still "succeeds" outwardly, so the scraper keeps harvesting
garbage instead of noticing detection and burning a fresh account. Reserve
`isBanned` for when you want the account to know it's caught. Note
`isBanned` alone doesn't block general commands — only `strade.ts`/
`trade.ts`/`doar.ts` and the general command dispatcher
(`packages/commandeer/services/commands.ts`) check it.
