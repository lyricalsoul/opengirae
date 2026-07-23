import { promoCodes, promoCodeRedemptions } from "./schemas/promo";
import { users } from "./schemas/users";
import { maybeTransaction } from "./decorators";
import { eq, and, sql } from "drizzle-orm";
import { EconomyDB } from "./economy";

export class PromoDB {
  static getPromoCode = maybeTransaction('getPromoCode', async (client, code: string) => {
    return await client.select().from(promoCodes).where(eq(promoCodes.code, code.toUpperCase())).limit(1).then(rows => rows[0]);
  })

  static getRedemptionCount = maybeTransaction('getRedemptionCount', async (client, promoCodeId: number) => {
    const rows = await client.select({ count: sql`count(*)` }).from(promoCodeRedemptions).where(eq(promoCodeRedemptions.promoCodeId, promoCodeId));
    return Number(rows[0]?.count ?? 0);
  })

  static hasRedeemed = maybeTransaction('hasRedeemed', async (client, userId: number, promoCodeId: number) => {
    const row = await client.select().from(promoCodeRedemptions).where(and(eq(promoCodeRedemptions.userId, userId), eq(promoCodeRedemptions.promoCodeId, promoCodeId))).limit(1).then(rows => rows[0]);
    return !!row;
  })

  // expired/already-redeemed/maxed-out are expected outcomes, not bugs - returned, not thrown.
  static consumeCode = maybeTransaction('consumeCode', async (client, codeStr: string, userId: number) => {
    const code = await client.select().from(promoCodes).where(eq(promoCodes.code, codeStr.toUpperCase())).limit(1).then(rows => rows[0]);
    if (!code) return { ok: false as const, reason: 'not_found' as const };
    if (new Date() > code.expiresAt) return { ok: false as const, reason: 'expired' as const };

    const row = await client.select().from(promoCodeRedemptions).where(and(eq(promoCodeRedemptions.userId, userId), eq(promoCodeRedemptions.promoCodeId, code.id))).limit(1).then(rows => rows[0]);
    if (row) return { ok: false as const, reason: 'already_redeemed' as const };

    if (code.maxUses) {
      const redRows = await client.select({ count: sql`count(*)` }).from(promoCodeRedemptions).where(eq(promoCodeRedemptions.promoCodeId, code.id));
      const redemptions = Number(redRows[0]?.count ?? 0);
      if (redemptions >= code.maxUses) return { ok: false as const, reason: 'max_uses' as const };
    }

    await client.insert(promoCodeRedemptions).values({
      userId,
      promoCodeId: code.id
    });

    const updates: Record<string, any> = {};
    // post-inflation amounts actually credited, for the caller to display
    const appliedRewards: Record<string, number> = { ...(code.rewards as Record<string, number>) };
    for (const [key, value] of Object.entries(code.rewards)) {
        const col = (users as any)[key];
        if (!col) continue;

        if (key === 'usedDraws') {
             updates[key] = sql`${col} - ${value}`;
        } else if (key === 'coins') {
             // only currency scales with incomeInflationRate, not stat adjustments like luckModifier
             const scaledValue = await EconomyDB.applyIncomeInflation(value as number);
             updates[key] = sql`${col} + ${scaledValue}`;
             appliedRewards[key] = scaledValue;
        } else {
             updates[key] = sql`${col} + ${value}`;
        }
    }

    if (Object.keys(updates).length > 0) {
        await client.update(users).set(updates).where(eq(users.id, userId));
    }

    return { ok: true as const, ...code, appliedRewards };
  })
}
