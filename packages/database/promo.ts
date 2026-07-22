import { promoCodes, promoCodeRedemptions } from "./schemas/promo";
import { users } from "./schemas/users";
import { maybeTransaction } from "./decorators";
import { eq, and, sql } from "drizzle-orm";

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

  static consumeCode = maybeTransaction('consumeCode', async (client, codeStr: string, userId: number) => {
    const code = await client.select().from(promoCodes).where(eq(promoCodes.code, codeStr.toUpperCase())).limit(1).then(rows => rows[0]);
    if (!code) throw new Error("Código inválido.");
    if (new Date() > code.expiresAt) throw new Error("Este código expirou.");

    const row = await client.select().from(promoCodeRedemptions).where(and(eq(promoCodeRedemptions.userId, userId), eq(promoCodeRedemptions.promoCodeId, code.id))).limit(1).then(rows => rows[0]);
    if (row) throw new Error("Você já resgatou este código.");

    if (code.maxUses) {
      const redRows = await client.select({ count: sql`count(*)` }).from(promoCodeRedemptions).where(eq(promoCodeRedemptions.promoCodeId, code.id));
      const redemptions = Number(redRows[0]?.count ?? 0);
      if (redemptions >= code.maxUses) throw new Error("O limite de resgates para este código foi atingido.");
    }

    await client.insert(promoCodeRedemptions).values({
      userId,
      promoCodeId: code.id
    });

    const updates: Record<string, any> = {};
    for (const [key, value] of Object.entries(code.rewards)) {
        const col = (users as any)[key];
        if (!col) continue;

        if (key === 'usedDraws') {
             updates[key] = sql`${col} - ${value}`;
        } else {
             updates[key] = sql`${col} + ${value}`;
        }
    }

    if (Object.keys(updates).length > 0) {
        await client.update(users).set(updates).where(eq(users.id, userId));
    }

    return code;
  })
}
