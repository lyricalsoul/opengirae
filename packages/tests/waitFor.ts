import { DBOS } from "@girae/common/dbos";

// polls until `fn` returns something truthy - use instead of a fixed setTimeout() sleep, which is either too short on a slow run or wastes time on a fast one.
export async function waitFor<T>(
  fn: () => T | Promise<T>,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<NonNullable<T>> {
  const { timeoutMs = 10_000, intervalMs = 25, label = 'condition' } = opts;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value as NonNullable<T>;
    if (Date.now() >= deadline) throw new Error(`waitFor: timed out after ${timeoutMs}ms waiting for ${label}`);
    await Bun.sleep(intervalMs);
  }
}

// returns whatever `p` rejected with; throws if it resolved. replaces expect(p).rejects.*, which hangs whole files under bun 1.3.14 (03-commands.md).
export async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('caught: expected the promise to reject, but it resolved');
}

// a "claim everything older than this" cutoff for rows the test just created: db now() and the host clock can differ by a few ms (and a ms-truncated Date can precede a us-precision createdAt), so a plain new Date() intermittently misses them.
export const futureCutoff = (marginMs = 5_000): Date => new Date(Date.now() + marginMs);

// the newest captured message once at least one exists (past startIndex) and no more have arrived for quietMs. Replaces "sleep N ms, then read the last message", which reads too early on a loaded machine and then sees whatever stale message was last.
export async function lastReply<T>(messages: T[], opts: { startIndex?: number; quietMs?: number; timeoutMs?: number } = {}): Promise<T> {
  const { startIndex = 0, quietMs = 150, timeoutMs = 10_000 } = opts;
  await waitFor(() => messages.length > startIndex, { timeoutMs, label: 'a reply to be captured' });
  let seen = messages.length;
  let quietSince = Date.now();
  while (Date.now() - quietSince < quietMs) {
    await Bun.sleep(25);
    if (messages.length !== seen) {
      seen = messages.length;
      quietSince = Date.now();
    }
  }
  return messages[messages.length - 1]!;
}

// resolves once the workflow has reached its nth DBOS.recv (1 = the first prompt), or has already finished - a flow that bails out before prompting (unknown id, nothing to do) never gets there, and that's a valid outcome for the callers. A recv records a DBOS.sleep step for its timeout before it blocks, so a workflow parked on its nth prompt has n of them; this replaces "sleep 500ms and hope it got there", and unlike that it's safe to mutate db state right after it returns.
export async function awaitRecv(workflowID: string, n = 1, timeoutMs = 10_000): Promise<void> {
  await waitFor(async () => {
    const steps = await DBOS.listWorkflowSteps(workflowID);
    if ((steps ?? []).filter(s => s.name === 'DBOS.sleep').length >= n) return true;
    const status = (await DBOS.getWorkflowStatus(workflowID))?.status;
    return status === 'SUCCESS' || status === 'ERROR' || status === 'CANCELLED';
  }, { timeoutMs, label: `workflow ${workflowID} to reach recv #${n} or finish` });
}
