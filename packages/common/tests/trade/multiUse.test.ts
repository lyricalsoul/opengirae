import { test, expect, describe, afterAll } from "bun:test";
import { rawClient, resumeQueue } from "../../queue";
import { processCallback } from "../../inbound/callback";
import type { StoredStep } from "../../commands/types";

// The bug this guards against: callback.ts used to hDel the pending event right
// after the authorIds/restricted check passed, before checking whether THIS
// specific click was valid for THIS specific clicker/state. A wrong-role click (e.g.
// the wrong party clicking a target-only option) would permanently destroy the
// event - the real intended clicker's later click then hit a missing key and
// silently no-op'd forever, even though the buttons were still visibly there. Fixed
// via `multiUse`: callback.ts no longer auto-deletes for multiUse steps at all - the
// workflow (via awaitMultiPartyChoice) deletes it itself once a click is actually
// valid. This test proves the storage-layer half of that fix directly, without
// needing a live DBOS workflow: a multiUse step's Redis entry must survive being
// "clicked," a non-multiUse step's must not.
describe("callback.ts multiUse handling", () => {
  const cleanupJobWorkflowIds: string[] = [];

  afterAll(async () => {
    const jobs = await resumeQueue.getJobs(['waiting', 'completed', 'failed', 'delayed']);
    await Promise.all(
      jobs
        .filter(j => cleanupJobWorkflowIds.includes(j.data?.workflowID))
        .map(j => j.remove().catch(() => undefined))
    );
  });

  async function seedStep(workflowID: string, eventName: string, multiUse: boolean): Promise<void> {
    const step: StoredStep = {
      options: [{ id: '0', data: 'accept' }, { id: '1', data: 'decline' }],
      authorIds: ['proposer-id', 'target-id'],
      restricted: 'author',
      multiUse,
    };
    await rawClient.hSet(`workflow:${workflowID}`, eventName, JSON.stringify(step));
  }

  test("multiUse: true survives a click - the event is not auto-consumed", async () => {
    const workflowID = `test-multiuse-${Date.now()}-a`;
    const eventName = 'invite';
    cleanupJobWorkflowIds.push(workflowID);
    await seedStep(workflowID, eventName, true);

    await processCallback(`${workflowID}.${eventName}.1`, 'proposer-id', 'cb-1');

    const stillThere = await rawClient.hGet(`workflow:${workflowID}`, eventName);
    expect(stillThere).not.toBeNull(); // NOT deleted - a second click must still be routable

    await rawClient.del(`workflow:${workflowID}`);
  });

  test("multiUse: false (default) is consumed after one click - unchanged legacy behavior", async () => {
    const workflowID = `test-multiuse-${Date.now()}-b`;
    const eventName = 'confirm';
    cleanupJobWorkflowIds.push(workflowID);
    await seedStep(workflowID, eventName, false);

    await processCallback(`${workflowID}.${eventName}.0`, 'proposer-id', 'cb-2');

    const gone = await rawClient.hGet(`workflow:${workflowID}`, eventName);
    expect(gone).toBeNull(); // single-author flows (girar, comprar, delcard) must keep this behavior

    await rawClient.del(`workflow:${workflowID}`);
  });

  test("a wrong-role click under multiUse still resumes the workflow (for the workflow itself to ignore) rather than being silently dropped", async () => {
    const workflowID = `test-multiuse-${Date.now()}-c`;
    const eventName = 'invite';
    cleanupJobWorkflowIds.push(workflowID);
    await seedStep(workflowID, eventName, true);

    // 'target-id' is in authorIds, so the restricted-set check passes; whether this
    // specific option is *valid* for that clicker is the workflow's job, not
    // callback.ts's - it must still be delivered.
    await processCallback(`${workflowID}.${eventName}.0`, 'target-id', 'cb-3');

    const jobs = await resumeQueue.getJobs(['waiting', 'completed']);
    const delivered = jobs.some(j => j.data?.workflowID === workflowID && j.data?.clickerUserId === 'target-id');
    expect(delivered).toBe(true);

    await rawClient.del(`workflow:${workflowID}`);
  });

  test("a click from outside authorIds is dropped regardless of multiUse", async () => {
    const workflowID = `test-multiuse-${Date.now()}-d`;
    const eventName = 'invite';
    cleanupJobWorkflowIds.push(workflowID);
    await seedStep(workflowID, eventName, true);

    await processCallback(`${workflowID}.${eventName}.0`, 'some-random-stranger', 'cb-4');

    const stillThere = await rawClient.hGet(`workflow:${workflowID}`, eventName);
    expect(stillThere).not.toBeNull(); // untouched - the click was rejected before consuming anything

    const jobs = await resumeQueue.getJobs(['waiting', 'completed']);
    const delivered = jobs.some(j => j.data?.workflowID === workflowID);
    expect(delivered).toBe(false); // never even reached the resume queue

    await rawClient.del(`workflow:${workflowID}`);
  });
});
