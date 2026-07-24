import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { uploadCardImage, isAnimatedCardMedia } from '../../services/cards/cardImage'
import { uploadFromUrl } from '@girae/common/utilities/storage'
import { inferCardData, resolveAmbiguousCategory, inferRarityOnly } from '../../services/cards/cardInference'
import { parseCardListing, parseSubcategoryListing, parseCardNameAndSubcategoryHint, parseCardHeader, extractCardName } from '../../services/cards/cardListingParser'
import { runCardWizard, finalizeCard } from '../../services/cards/cardWizard'
import { getAddcardSession, setAddcardSession } from '../../services/cards/addcardSession'
import type { IncomingCommand } from '@girae/common/commands/types'

export default class AddCardCommand extends Command {
  static override info = {
    name: 'addcard',
    description: 'Adiciona uma nova carta a partir de uma mensagem respondida (staff)',
    usage: '/addcard <descrição>',
    useWorkflow: true
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'content', type: CommandArgumentType.STRING, nullable: true }])
  static override async execute(ctx: IncomingCommand, args: { content?: string }) {
    const sourceText = args.content || ctx.message.replyTo?.content
    const photoUrl = ctx.message.photoUrl ?? ctx.message.replyTo?.photoUrl

    const isAnimated = isAnimatedCardMedia(ctx)

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

    const header = parseCardHeader(sourceText)
    if (header) {
      const headerCorrection = await CardsDB.getCorrection(header.name)
      const categoryName = headerCorrection ? undefined : (header.categoryHint === 'ambiguous' ? await resolveAmbiguousCategory(header.name) : header.categoryHint)
      const category = headerCorrection
        ? await CardsDB.getCategory(headerCorrection.categoryId)
        : await CardsDB.getOrCreateCategory(categoryName!)
      if (!category) return

      const subcategoryName = headerCorrection?.subcategoryName ?? header.name
      const existing = await CardsDB.getSubcategoryByNameAndCategory(subcategoryName, category.id)
      const cdnUrl = await uploadFromUrl(photoUrl, 'subcategories')
      const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
      if (!user) return

      const subcategory = existing
        ? await CardsDB.updateSubcategory(existing.id, { imageUrl: cdnUrl })
        : await CardsDB.createSubcategory(subcategoryName, category.id, cdnUrl)
      if (!subcategory) return

      await AuditDB.log(user.id, existing ? 'subcategory.updatePhoto' : 'subcategory.create', { subcategoryId: subcategory.id, name: subcategory.name, categoryEmoji: category.emoji })
      await setAddcardSession(ctx.message.chat.id, ctx.message.chat.threadId, {
        subcategoryId: subcategory.id,
        subcategoryName: subcategory.name,
        categoryId: category.id,
        categoryName: category.name,
      })
      await reply(ctx, `📂 Subcategoria **${escapeMarkdown(subcategory.name)}** ${existing ? 'atualizada' : 'criada'} com foto.\n💡 Cards adicionados neste chat agora entram automaticamente em **${escapeMarkdown(subcategory.name)}**.`)
      return
    }

    const parsed = parseCardListing(sourceText)
    if (parsed) {
      const correction = await CardsDB.getCorrection(parsed.subcategory)
      const categoryId = correction?.categoryId ?? parsed.categoryId
      const subcategoryName = correction?.subcategoryName ?? parsed.subcategory

      const category = await CardsDB.getCategory(categoryId)
      if (!category) {
        await reply(ctx, 'Categoria configurada para esse formato não existe mais.')
        return
      }

      const existingSubcategory = await CardsDB.getSubcategoryByNameAndCategory(subcategoryName, category.id)
      if (existingSubcategory) {
        const duplicate = await CardsDB.getCardByNameAndSubcategory(parsed.name, existingSubcategory.id)
        if (duplicate) {
          await reply(ctx, {
            content: `⚠️ Já existe um card chamado **${escapeMarkdown(parsed.name)}** em **${escapeMarkdown(existingSubcategory.name)}** (\`${duplicate.id}\`).`,
            eventName: 'addcard:confirmDuplicate',
            restricted: 'none',
            options: [
              { title: '✅ Criar mesmo assim', data: true },
              { title: '❌ Cancelar', data: false },
            ],
          })

          const confirmSelection = await DBOS.recv<{ value: boolean, messageId?: string }>('addcard:confirmDuplicate')
          if (confirmSelection?.messageId) await deleteMsg(ctx, confirmSelection.messageId)
          if (!confirmSelection?.value) {
            await reply(ctx, 'Upload cancelado.')
            return
          }
        }
      }

      const cdnUrl = isAnimated ? await uploadFromUrl(photoUrl, 'cards') : await uploadCardImage(photoUrl)
      await finalizeCard(replyCtx, {
        name: parsed.name,
        category: category.name,
        subcategory: subcategoryName,
        rarity: parsed.rarity,
        tags: [],
      }, cdnUrl, 'create')
      return
    }

    const subcategoryListing = parseSubcategoryListing(sourceText)
    if (subcategoryListing) {
      const listingCorrection = await CardsDB.getCorrection(subcategoryListing.subcategory)
      const categoryId = listingCorrection?.categoryId ?? subcategoryListing.categoryId
      const subcategoryName = listingCorrection?.subcategoryName ?? subcategoryListing.subcategory

      const category = await CardsDB.getCategory(categoryId)
      if (!category) {
        await reply(ctx, 'Categoria configurada para esse formato não existe mais.')
        return
      }

      const existing = await CardsDB.getSubcategoryByNameAndCategory(subcategoryName, category.id)
      const cdnUrl = await uploadFromUrl(photoUrl, 'subcategories')
      const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
      if (!user) return

      if (existing) {
        await CardsDB.updateSubcategory(existing.id, { imageUrl: cdnUrl })
        await AuditDB.log(user.id, 'subcategory.updatePhoto', { subcategoryId: existing.id, name: existing.name })
        await reply(ctx, `🖼️ Foto de **${escapeMarkdown(existing.name)}** atualizada.`)
      } else {
        const created = await CardsDB.createSubcategory(subcategoryName, category.id, cdnUrl)
        if (!created) return
        await AuditDB.log(user.id, 'subcategory.create', { subcategoryId: created.id, name: created.name, categoryEmoji: category.emoji })
        await reply(ctx, `📂 Subcategoria **${escapeMarkdown(created.name)}** criada com foto.`)
      }
      return
    }

    const session = await getAddcardSession(ctx.message.chat.id, ctx.message.chat.threadId)
    if (session) {
      const name = extractCardName(sourceText)

      const duplicate = await CardsDB.getCardByNameAndSubcategory(name, session.subcategoryId)
      if (duplicate) {
        await reply(ctx, {
          content: `⚠️ Já existe um card chamado **${escapeMarkdown(name)}** em **${escapeMarkdown(session.subcategoryName)}** (\`${duplicate.id}\`).`,
          eventName: 'addcard:confirmDuplicate',
          restricted: 'none',
          options: [
            { title: '✅ Criar mesmo assim', data: true },
            { title: '❌ Cancelar', data: false },
          ],
        })

        const confirmSelection = await DBOS.recv<{ value: boolean, messageId?: string }>('addcard:confirmDuplicate')
        if (confirmSelection?.messageId) await deleteMsg(ctx, confirmSelection.messageId)
        if (!confirmSelection?.value) {
          await reply(ctx, 'Upload cancelado.')
          return
        }
      }

      const rarity = await inferRarityOnly(name, session.subcategoryName, rarities.map(r => r.name)) ?? rarities[0]!.name
      const cdnUrl = isAnimated ? await uploadFromUrl(photoUrl, 'cards') : await uploadCardImage(photoUrl)
      await finalizeCard(replyCtx, {
        name,
        category: session.categoryName,
        subcategory: session.subcategoryName,
        rarity,
        tags: [],
      }, cdnUrl, 'create')
      return
    }

    const categories = await CardsDB.getCategories()

    const nameSubcategoryHint = parseCardNameAndSubcategoryHint(sourceText)
    const inferred = await inferCardData(
      sourceText,
      categories,
      rarities.map(r => r.name),
      nameSubcategoryHint?.name,
      nameSubcategoryHint?.subcategoryHint,
    )
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
