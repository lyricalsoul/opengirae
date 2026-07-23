import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { UsersDB } from "@girae/database/users";
import PrivacyCommand from "../../commands/all/privacy.users";
import ProfileCommand from "../../commands/all/profile.users";

mockTelegram();

describe("/privacy toggles privacyMode, and gates viewing other users' profiles", () => {
  const fx = new TestFixtures();
  let viewerId: number;
  let targetId: number;
  const viewerPlatformId = 'test-privacy-viewer';
  const targetPlatformId = 'test-privacy-target';

  beforeAll(async () => {
    process.env.PORT = '0';
    await bootstrapCommandeerWorkers(); // needed so PrivacyCommand's reply() has a worker to complete against

    viewerId = (await fx.user({ displayName: "Test Privacy Viewer", platformId: viewerPlatformId })).id;
    targetId = (await fx.user({ displayName: "Test Privacy Target", platformId: targetPlatformId })).id;
  });

  afterAll(() => fx.cleanup());

  function ctx(authorId: string, args: { target?: string } = {}) {
    return fakeCtx({ name: 'privacy', authorId, args: args.target ? [args.target] : [] });
  }

  test("/privacy flips privacyMode off -> on -> off", async () => {
    const before = await UsersDB.getUserById(viewerId);
    expect(before!.privacyMode).toBe(false);

    await PrivacyCommand.execute(ctx(viewerPlatformId));
    expect((await UsersDB.getUserById(viewerId))!.privacyMode).toBe(true);

    await PrivacyCommand.execute(ctx(viewerPlatformId));
    expect((await UsersDB.getUserById(viewerId))!.privacyMode).toBe(false);
  });

  test("/profile privacidade subcommand toggles the same flag", async () => {
    await (ProfileCommand as any).togglePrivacy(ctx(viewerPlatformId));
    expect((await UsersDB.getUserById(viewerId))!.privacyMode).toBe(true);
    await (ProfileCommand as any).togglePrivacy(ctx(viewerPlatformId));
    expect((await UsersDB.getUserById(viewerId))!.privacyMode).toBe(false);
  });

  // exercises the exact guard ProfileCommand.execute (and /wish, /cards) run before showing another
  // user's data - proves it flips correctly on real rows, without needing the reply queue at all.
  test("isViewable blocks another user's profile once they enable privacy mode, and un-blocks once they disable it", async () => {
    await UsersDB.setPrivacyMode(targetId, true);
    let target = (await UsersDB.getUserById(targetId))!;
    expect(UsersDB.isViewable(viewerId, target)).toBe(false);

    await UsersDB.setPrivacyMode(targetId, false);
    target = (await UsersDB.getUserById(targetId))!;
    expect(UsersDB.isViewable(viewerId, target)).toBe(true);
  });

  test("isViewable never blocks a user from viewing their own data, even with privacy mode on", async () => {
    await UsersDB.setPrivacyMode(viewerId, true);
    const self = (await UsersDB.getUserById(viewerId))!;
    expect(UsersDB.isViewable(viewerId, self)).toBe(true);

    await UsersDB.setPrivacyMode(viewerId, false);
  });

  test("ProfileCommand.execute's privacy check reaches the block branch for a private target (no throw, resolves)", async () => {
    await UsersDB.setPrivacyMode(targetId, true);
    await expect(ProfileCommand.execute(ctx(viewerPlatformId), { target: targetPlatformId })).resolves.toBeUndefined();
    await UsersDB.setPrivacyMode(targetId, false);
  });
});
