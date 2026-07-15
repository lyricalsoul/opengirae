import { Command } from '@girae/common/commands'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { reply } from '@girae/common/dbos/messaging'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { uploadCardImage } from '../../services/cardImage'
import { uploadFromUrl } from '../../services/storage'
import { inferCardData } from '../../services/cardInference'
import { parseCardListing, parseSubcategoryListing } from '../../services/cardListingParser'
import { runCardWizard, finalizeCard } from '../../services/cardWizard'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class AddCardCommand extends Command {
  static override info = {
    name: 'addcard',
    description: 'Adiciona uma nova carta a partir de uma mensagem respondida (staff)',
    usage: '/addcard <descrição>',
    useWorkflow: true
  }

  @DBOS.workflow()
  static override async execute(ctx: IncomingCommand) {
    const sourceText = ctx.args.join(' ').trim() || ctx.message.replyTo?.content
    const photoUrl = ctx.message.photoUrl ?? ctx.message.replyTo?.photoUrl

    const isAnimated = ctx.message.photoUrl ? ctx.message.isAnimatedPhoto : ctx.message.replyTo?.isAnimatedPhoto

    if (!sourceText) {
      await reply(ctx, 'Descreva o card nos argumentos (ex: `/addcard Winter da aespa, era Armageddon`) ou responda a uma mensagem com essa descrição.')
      return
    }
    if (!photoUrl) {
      await reply(ctx, 'Não encontrei nenhuma foto na mensagem ou na resposta.')
      return
    }

    const rarities = await CardsDB.getRarities()
    if (rarities.length === 0) {
      await reply(ctx, 'Não há raridades cadastradas ainda.')
      return
    }

    const replyCtx = ctx.message.replyTo
      ? { ...ctx, message: { ...ctx.message, id: ctx.message.replyTo.id } }
      : ctx

    const parsed = parseCardListing(sourceText)
    if (parsed) {
      const category = await CardsDB.getCategory(parsed.categoryId)
      if (!category) {
        await reply(ctx, 'Categoria configurada para esse formato não existe mais.')
        return
      }

      const existingSubcategory = await CardsDB.getSubcategoryByNameAndCategory(parsed.subcategory, category.id)
      if (existingSubcategory) {
        const duplicate = await CardsDB.getCardByNameAndSubcategory(parsed.name, existingSubcategory.id)
        if (duplicate) {
          await reply(ctx, `⚠️ Já existe um card chamado **${escapeMarkdown(parsed.name)}** em **${escapeMarkdown(existingSubcategory.name)}** (\`${duplicate.id}\`). Upload rejeitado.`)
          return
        }
      }

      const cdnUrl = isAnimated ? await uploadFromUrl(photoUrl, 'cards') : await uploadCardImage(photoUrl)
      await finalizeCard(replyCtx, {
        name: parsed.name,
        category: category.name,
        subcategory: parsed.subcategory,
        rarity: parsed.rarity,
        tags: [],
      }, cdnUrl, 'create')
      return
    }

    const subcategoryListing = parseSubcategoryListing(sourceText)
    if (subcategoryListing) {
      const category = await CardsDB.getCategory(subcategoryListing.categoryId)
      if (!category) {
        await reply(ctx, 'Categoria configurada para esse formato não existe mais.')
        return
      }

      const existing = await CardsDB.getSubcategoryByNameAndCategory(subcategoryListing.subcategory, category.id)
      const cdnUrl = await uploadFromUrl(photoUrl, 'subcategories')
      const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
      if (!user) return

      if (existing) {
        await CardsDB.updateSubcategory(existing.id, { imageUrl: cdnUrl })
        await AuditDB.log(user.id, 'subcategory.updatePhoto', { subcategoryId: existing.id, name: existing.name })
        await reply(ctx, `🖼️ Foto de **${escapeMarkdown(existing.name)}** atualizada.`)
      } else {
        const created = await CardsDB.createSubcategory(subcategoryListing.subcategory, category.id, cdnUrl)
        if (!created) return
        await AuditDB.log(user.id, 'subcategory.create', { subcategoryId: created.id, name: created.name, categoryEmoji: category.emoji })
        await reply(ctx, `📂 Subcategoria **${escapeMarkdown(created.name)}** criada com foto.`)
      }
      return
    }

    const categories = await CardsDB.getCategories()
    const musicaCategory = categories.find(c => c.name === 'Música')
    const musicaSubcategories = musicaCategory
      ? (await CardsDB.getSubcategoriesForCategory(musicaCategory.id)).map(s => s.name)
      : []

    const inferred = await inferCardData(sourceText, categories.map(c => c.name), rarities.map(r => r.name), musicaSubcategories)
    if (!inferred) {
      await reply(ctx, 'Não foi possível inferir os dados do card. Tente novamente.')
      return
    }
    if (inferred.error) {
      await reply(ctx, `⚠️ ${inferred.error}`)
      return
    }

    const cdnUrl = isAnimated ? await uploadFromUrl(photoUrl, 'cards') : await uploadCardImage(photoUrl)
    await runCardWizard(replyCtx, {
      cardData: {
        name: inferred.name,
        category: inferred.category,
        subcategory: inferred.subcategory,
        rarity: inferred.rarity,
        tags: (inferred.tags ?? []).filter(Boolean),
      },
      photoUrl: cdnUrl,
      mode: 'create',
    })
  }
}
