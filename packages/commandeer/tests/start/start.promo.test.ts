import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mockTelegram, bootstrapCommandeerWorkers, fakeCtx, TestFixtures } from "@girae/tests";
import { db } from "@girae/database/index";
import { users } from "@girae/database/schemas/users";
import { promoCodes, promoCodeRedemptions } from "@girae/database/schemas/promo";
import { eq } from "drizzle-orm";
import StartCommand from "../../commands/all/start.main";

// Initialize the telegram mock at the module level before any imports that use it.
const { sentMessages } = mockTelegram();

describe("/start promo code E2E", () => {
    const fx = new TestFixtures();
    let testUserId: number;
    let testPlatformId: string;
    let codeStr: string;
    let promoCodeId: number;

    beforeAll(async () => {
        // Starts answerer worker (and DBOS runtime) to process the `reply` queue
        process.env.PORT = '0';
        await bootstrapCommandeerWorkers();

        testPlatformId = `test-start-promo-${Date.now()}`;
        testUserId = (await fx.user({ displayName: "Test User", platform: 'telegram', platformId: testPlatformId })).id;
        await db.update(users).set({ coins: 10 }).where(eq(users.id, testUserId));

        codeStr = 'T' + Math.random().toString(36).substring(2, 7).toUpperCase();
        const [inserted] = await db.insert(promoCodes).values({
            code: codeStr,
            rewards: { coins: 50 },
            expiresAt: new Date(Date.now() + 1000000),
            maxUses: 10
        }).returning({ id: promoCodes.id });
        promoCodeId = inserted!.id;

        fx.onCleanup(async () => {
            await db.delete(promoCodeRedemptions).where(eq(promoCodeRedemptions.promoCodeId, promoCodeId));
            await db.delete(promoCodes).where(eq(promoCodes.code, codeStr));
        });
    });

    afterAll(() => fx.cleanup());

    test("should redeem a promo code and give rewards, formatting the message correctly", async () => {
        sentMessages.length = 0; // reset sentMessages array

        const ctx = fakeCtx({ name: 'start', authorId: testPlatformId, platform: 'telegram', chatId: 'chat-1' });

        // Call the command execute directly
        await StartCommand.execute(ctx, { payload: codeStr });

        // Wait a tiny bit for the answerer worker to pick up the reply from the queue
        await new Promise(resolve => setTimeout(resolve, 1500));

        const userRow = await db.query.users.findFirst({
            where: (u, { eq }) => eq(u.id, testUserId)
        });

        expect(userRow?.coins).toBe(60); // 10 initial + 50 reward

        expect(sentMessages.length).toBeGreaterThanOrEqual(1);
        const lastMessage = sentMessages[sentMessages.length - 1]!;
        // the mock puts the raw message content in `text` or `content` or via parameters depending on how `telegramsjs` maps it.
        // usually it's passed as `text` for sendMessage
        const contentStr = lastMessage.text || lastMessage.content || lastMessage.caption || '';
        expect(contentStr).toInclude('Como você usou nosso código de resgate');
        expect(contentStr).toInclude('<strong>50</strong> moedas');
    });
});
