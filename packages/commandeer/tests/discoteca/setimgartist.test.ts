import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, fakeCtx, TestFixtures, hasRealStorage } from "@girae/tests";
import { DiscotecaDB } from "@girae/database/discoteca";
import { auditLogs } from "@girae/database/schemas/audit";
import { db } from "@girae/database/index";
import { eq } from "drizzle-orm";

const { sentMessages } = mockTelegram();

import SetImgArtistCommand from "../../commands/admin/setimgartist";

describe("/setimgartist", () => {
  const fx = new TestFixtures();
  let staffPlatformId: string;
  let staffId: number;

  beforeAll(async () => {
    // /setimgartist isn't a DBOS workflow command - only the answerer worker is needed to drain the reply queue into sentMessages
    await import("@girae/answerer/index");
    staffPlatformId = `test-setimgartist-staff-${Date.now()}`;
    staffId = (await fx.user({ displayName: "Test Setimgartist Staff", platform: 'telegram', platformId: staffPlatformId })).id;
    fx.onCleanup(async () => { await db.delete(auditLogs).where(eq(auditLogs.actorUserId, staffId)); });
  });

  afterAll(() => fx.cleanup());

  test.skipIf(!hasRealStorage)("uploads the replied photo and stores it as the artist's banner", async () => {
    const artist = await fx.discotecaArtist({ name: "Test Banner Target Artist" });

    const originalFetch = fetch;
    // @ts-expect-error bun-types declares fetch as a namespace, this reassignment is intentional
    fetch = (async () => new Response(new Uint8Array([0]))) as unknown as typeof fetch;
    try {
      const runCtx = fakeCtx({
        name: 'setimgartist', authorId: staffPlatformId, args: [String(artist.id)], platform: 'telegram',
        photoUrl: 'https://example.com/banner.jpg',
      });
      await SetImgArtistCommand.execute(runCtx, { artist: { id: artist.id, name: "Test Banner Target Artist" } } as any);
    } finally {
      // @ts-expect-error bun-types declares fetch as a namespace, this reassignment is intentional
      fetch = originalFetch;
    }

    const updated = await DiscotecaDB.getArtist(artist.id);
    expect(updated?.imageUrl).toBeTruthy();
    expect(sentMessages.some(m => m.method === 'sendPhoto')).toBe(true);
  });
});
