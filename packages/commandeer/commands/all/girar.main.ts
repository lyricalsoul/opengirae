import { Command } from '@girae/common/commands'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { GachaLogic } from '@girae/database/gacha'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import { rawClient } from '@girae/common/queue'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class GirarCommand extends Command {
  static override info = {
    name: 'girar',
    description: 'Tente a sorte e puxe uma carta!',
    aliases: ['rodar', 'rechear', 'carimbar', 'draw', 'gi'],
    useWorkflow: true
  }

  static CATEGORY_SELECTED_EVENT = 'categorySelected'
  static SUBCATEGORY_SELECTED_EVENT = 'subcategorySelected'

  @DBOS.workflow()
  static override async execute(ctx: IncomingCommand) {
    const lockKey = `girar:lock:${ctx.message.author.id}`;
    const existingLock = await rawClient.get(lockKey);

    if (existingLock) {
      const lockData = JSON.parse(existingLock);
      const cleanChatId = lockData.chatId.replace(/^-100/, '');
      const url = `https://t.me/c/${cleanChatId}/${lockData.messageId}`;

      await reply(ctx, {
        content: "⚠️ Você já está girando! Termine-a antes de girar novamente.",
        buttons: [{ text: "Continuar jogada atual", url }]
      });
      return;
    }

    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id);
    if (!user) {
      return;
    }

    if (user.usedDraws >= user.maxDraws) {
      await reply(ctx, `Você atingiu seu limite diário de ${user.maxDraws} rodadas! Volte amanhã.`);
      return;
    }

    await rawClient.set(lockKey, JSON.stringify({
      chatId: ctx.message.chat.id,
      messageId: ctx.message.id,
      workflowID: ctx.workflowIDToBeAssigned
    }), { EX: 3600 });

    try {
      const categories = await CardsDB.getCategories()
      await reply(ctx, {
        content: 'Escolha uma categoria...',
        eventName: GirarCommand.CATEGORY_SELECTED_EVENT,
        restricted: 'author',
        options: categories.map(c => ({ title: `${c.emoji} ${c.name}`, data: c.id }))
      })

      const categorySelection = await DBOS.recv<{ value: number, messageId?: string }>(GirarCommand.CATEGORY_SELECTED_EVENT)
      if (!categorySelection?.value) return
      const categoryId = categorySelection.value
      let messageId = categorySelection.messageId

      const category = await CardsDB.getCategory(categoryId);
      if (!category) return;

      const allSubcategories = await GachaLogic.getSubcategoriesForDraw(categoryId);
      const selectedSubcategories = GachaLogic.selectSubcategories(
        allSubcategories,
        category.subcategoriesOnDraw,
        user.luckModifier
      );

      if (selectedSubcategories.length === 0) {
        await reply(ctx, "Nenhuma subcategoria disponível nesta categoria!");
        return;
      }

      await reply(ctx, {
        content: 'Escolha uma subcategoria...',
        eventName: GirarCommand.SUBCATEGORY_SELECTED_EVENT,
        restricted: 'author',
        options: selectedSubcategories.map(c => ({ title: c.name, data: c.id })),
        editMessageId: messageId,
      })

      const subcategorySelection = await DBOS.recv<{ value: number, messageId?: string }>(GirarCommand.SUBCATEGORY_SELECTED_EVENT)
      if (!subcategorySelection?.value) return
      const subcategoryId = subcategorySelection.value
      messageId = subcategorySelection.messageId ?? messageId

      const cardPool = await GachaLogic.getCardsForDraw(subcategoryId);
      const drawnCard = GachaLogic.selectCard(cardPool);

      if (!drawnCard) {
        await reply(ctx, "Esta subcategoria está vazia!");
        return;
      }

      // TODO: could these be a single function call inside a transaction for better performance and stability?
      const userCard = await CardsDB.addUserCard(user.id, drawnCard.id);
      await CardsDB.addCardDrawHistory(user.id, drawnCard.id, categoryId, subcategoryId);
      await UsersDB.incrementUsedDraws(user.id);

      if (messageId) {
        await deleteMsg(ctx, messageId);
      }

      const subcategory = allSubcategories.find(s => s.id === subcategoryId);
      const subcategoryName = subcategory?.name ?? 'Desconhecida';
      const count = userCard?.count ?? 1;

      const text = `🎰 Parabéns, você ganhou e vai levar:

${drawnCard.rarityEmoji} ${drawnCard.id}. **${drawnCard.name}** \`${count}x\`
${category.emoji} ${subcategoryName}

👾 ${user.id}. \`${ctx.message.author.name}\``;

      await reply(ctx, {
        content: text,
        photoUrl: drawnCard.imageUrl ?? 'https://placehold.co/600x400/png'
      });
    } finally {
      await rawClient.del(lockKey);
    }
  }
}
