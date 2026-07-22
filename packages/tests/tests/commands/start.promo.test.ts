import { describe, test, expect, beforeAll, spyOn } from 'bun:test'
import { mockTelegram } from '../../telegramMock'
import { db } from '@girae/database'
import { promoCodes } from '@girae/database/schemas/promo'
import { users, linkedAccounts } from '@girae/database/schemas/users'
import type { IncomingCommand } from '@girae/common/commands/types'

let tgMock: ReturnType<typeof mockTelegram> = { sentMessages: [] };

import { mock } from 'bun:test'
mock.module('@dbos-inc/dbos-sdk', () => ({
    DBOS: {
        isInitialized: () => false,
        workflow: () => (target: any, propertyKey: string, descriptor: PropertyDescriptor) => descriptor
    }
}));

import * as messaging from '@girae/common/dbos/messaging'

const replySpy = spyOn(messaging, 'reply').mockImplementation(async (cmd, content) => {
    tgMock.sentMessages.push({
        method: 'sendMessage',
        content: typeof content === 'string' ? content : content.content
    });
    return 'mock-msg-id';
});

describe('Start Promo Code Redemption', () => {
    test('should redeem a promo code and give rewards', async () => {
        tgMock = mockTelegram();
        tgMock.sentMessages.length = 0; // reset

        const testPlatformId = `999999999-${Date.now()}`;
        // Insert a test user
        const [{ id: testUserId }] = await db.insert(users).values({
            username: `testuser-${Date.now()}`,
            displayName: 'Test User',
            avatarUrl: 'https://example.com/avatar.png',
            coins: 10
        }).returning({ id: users.id });

        // Link Telegram account
        await db.insert(linkedAccounts).values({
            userId: testUserId,
            platform: 'telegram',
            platformId: testPlatformId
        });

        // Insert a test promo code
        const codeStr = 'T' + Math.random().toString(36).substring(2, 7).toUpperCase();
        await db.insert(promoCodes).values({
            code: codeStr,
            rewards: { coins: 50 },
            expiresAt: new Date(Date.now() + 1000000),
            maxUses: 10
        });

        const ctx: IncomingCommand = {
            name: 'start',
            args: [],
            workflowIDToBeAssigned: 'test-wf-1',
            message: {
                id: 'msg-1',
                author: { id: testPlatformId, name: 'Test User', avatarUrl: '' },
                chat: { id: 'chat-1', title: 'Test Chat' },
                content: '/start TSTCOD',
                timestamp: new Date(),
                platform: 'telegram'
            }
        };

        const StartCommand = (await import('@girae/commandeer/commands/all/start.main')).default;
        await StartCommand.execute(ctx, { payload: codeStr });

        // Check the database for rewards
        const userRow = await db.query.users.findFirst({
            where: (u, { eq }) => eq(u.id, testUserId)
        });

        expect(userRow?.coins).toBe(60); // 10 initial + 50 reward

        // Check if message was sent
        expect(tgMock.sentMessages.length).toBe(1);
        expect(tgMock.sentMessages[0].content).toInclude('Como você usou nosso código de resgate');
        expect(tgMock.sentMessages[0].content).toInclude('50* moedas');
    });
});
