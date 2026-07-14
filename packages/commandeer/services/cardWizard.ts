import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { reply, deleteMsg, awaitTextReply } from '@girae/common/dbos/messaging'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import type { IncomingCommand } from '@girae/common/commands/types'
import { EMOJI } from '../constants'

export interface CardData {
  name: string
  category: string
  subcategory: string
  rarity: string
  tags: string[]
}

type TextField = 'name' | 'category' | 'subcategory'
type Action =
  | { action: 'rarity', value: string }
  | { action: 'edit', field: TextField | 'tags' }
  | { action: 'confirm' }
  | { action: 'cancel' }

const FIELD_PROMPTS: Record<TextField | 'tags', string> = {
  name: 'Envie o novo nome.',
  category: 'Envie a nova categoria.',
  subcategory: 'Envie a nova subcategoria.',
  tags: 'Envie as novas tags separadas por vírgula (ou "limpar" para remover).',
}

const ACTION_EVENT = 'cardwizard:action'
const TEXT_EVENT = 'cardwizard:text'

const cardActionButtons = (cardId: number) => [
  { text: '✏️ Editar', runCommand: { name: 'editcard', args: [String(cardId)] } },
  { text: '🗑️ Deletar', runCommand: { name: 'delcard', args: [String(cardId)] } },
]

function diffFields(before: CardData, after: CardData): Array<{ field: string, oldValue: string, newValue: string }> {
  const changes: Array<{ field: string, oldValue: string, newValue: string }> = []
  for (const field of ['name', 'category', 'subcategory', 'rarity'] as const) {
    if (before[field] !== after[field]) changes.push({ field, oldValue: before[field], newValue: after[field] })
  }
  const beforeTags = before.tags.join(', ')
  const afterTags = after.tags.join(', ')
  if (beforeTags !== afterTags) changes.push({ field: 'tags', oldValue: beforeTags, newValue: afterTags })
  return changes
}

export async function finalizeCard(
  ctx: IncomingCommand,
  cardData: CardData,
  photoUrl: string,
  mode: 'create' | 'edit',
  existingCardId?: number,
  messageId?: string,
  before?: CardData,
) {
  const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
  if (!user) return

  const category = await CardsDB.getOrCreateCategory(cardData.category)
  if (!category) return
  const subcategory = await CardsDB.getOrCreateSubcategory(cardData.subcategory, category.id)
  const rarity = await CardsDB.getRarityByName(cardData.rarity)
  if (!subcategory || !rarity) {
    await reply(ctx, mode === 'edit' ? 'Não foi possível editar o card.' : 'Não foi possível criar o card.')
    return
  }

  const secondarySubcategoryIds = (await Promise.all(
    cardData.tags.map(tag => CardsDB.getOrCreateSubcategory(tag, category.id))
  )).filter((s): s is NonNullable<typeof s> => !!s).map(s => s.id)

  if (mode === 'edit' && existingCardId) {
    await CardsDB.updateCard(existingCardId, { name: cardData.name, rarityId: rarity.id, imageUrl: photoUrl })
    await CardsDB.setCardSubcategories(existingCardId, subcategory.id, secondarySubcategoryIds)

    await AuditDB.log(user.id, 'card.edit', { cardId: existingCardId, changes: diffFields(before!, cardData) })

    if (messageId) await deleteMsg(ctx, messageId)
    await reply(ctx, {
      content: `🃏 Card atualizado: \n\n${rarity.emoji} ${existingCardId}. ${escapeMarkdown(cardData.name)}\n${category.emoji} ${escapeMarkdown(subcategory.name)}`,
      photoUrl,
      buttons: cardActionButtons(existingCardId),
    })
    return
  }

  const card = await CardsDB.createCard(cardData.name, rarity.id, photoUrl, subcategory.id, secondarySubcategoryIds)
  if (!card) return

  await AuditDB.log(user.id, 'card.create', { cardId: card.id, name: cardData.name, rarityName: rarity.name, categoryEmoji: category.emoji })

  if (messageId) await deleteMsg(ctx, messageId)
  await reply(ctx, {
    content: `🃏 Carta criada: \n\n${rarity.emoji} ${card.id}. ${escapeMarkdown(cardData.name)}\n${category.emoji} ${escapeMarkdown(subcategory.name)}`,
    photoUrl,
    buttons: cardActionButtons(card.id),
  })
}

export async function runCardWizard(
  ctx: IncomingCommand,
  initial: { cardData: CardData, photoUrl: string, mode: 'create' | 'edit', existingCardId?: number }
) {
  const { photoUrl, mode, existingCardId } = initial
  const cardData: CardData = { ...initial.cardData, tags: [...initial.cardData.tags] }
  const before: CardData = { ...initial.cardData, tags: [...initial.cardData.tags] }

  const rarities = await CardsDB.getRarities()
  if (rarities.length === 0) {
    await reply(ctx, 'Não há raridades cadastradas ainda.')
    return
  }

  let messageId: string | undefined
  while (true) {
    const [categoryExists, subcategoryExists, rarityExists] = await Promise.all([
      CardsDB.getCategoryByName(cardData.category),
      CardsDB.getSubcategoryByName(cardData.subcategory),
      CardsDB.getRarityByName(cardData.rarity),
    ])
    const duplicate = subcategoryExists
      ? await CardsDB.getCardByNameAndSubcategory(cardData.name, subcategoryExists.id)
      : null
    const isDuplicateOfSelf = mode === 'edit' && duplicate?.id === existingCardId

    let warnings = ''
    if (!categoryExists) warnings += '\n⚠️ Esta categoria não existe e será criada.'
    if (!subcategoryExists) warnings += '\n⚠️ Esta subcategoria não existe e será criada.'
    if (!rarityExists) warnings += '\n🚫 Raridade inválida. Escolha uma das opções abaixo.'
    if (duplicate && !isDuplicateOfSelf) warnings += `\n⚠️ Este card já existe (\`${duplicate.id}\`). Confirme antes de upar novamente.`

    const rarityEmoji = rarities.find(r => r.name === cardData.rarity)?.emoji ?? '❓'
    const editingLabel = mode === 'edit' ? ` (editando \`${existingCardId}\`)` : ''
    const tagsLine = cardData.tags.length > 0 ? `\n🏷 ${cardData.tags.map(escapeMarkdown).join(', ')}` : ''
    const preview = `${EMOJI.dice} **${escapeMarkdown(cardData.name)}**${editingLabel}\n\n📁 ${escapeMarkdown(cardData.category)}\n📂 ${escapeMarkdown(cardData.subcategory)}\n${rarityEmoji} ${escapeMarkdown(cardData.rarity)}${tagsLine}${warnings}`

    const options = [
      ...rarities.map(r => ({ title: `${r.emoji} ${r.name}`, data: { action: 'rarity', value: r.name } as Action })),
      { title: '📁 Categoria', data: { action: 'edit', field: 'category' } as Action },
      { title: '📂 Subcategoria', data: { action: 'edit', field: 'subcategory' } as Action },
      { title: '📓 Nome', data: { action: 'edit', field: 'name' } as Action },
      { title: '🏷️ Tags', data: { action: 'edit', field: 'tags' } as Action },
      { title: '✅ Confirmar', data: { action: 'confirm' } as Action },
      { title: '❌ Cancelar', data: { action: 'cancel' } as Action },
    ]

    await reply(ctx, {
      content: preview,
      photoUrl,
      eventName: ACTION_EVENT,
      restricted: 'author',
      options,
      rows: [rarities.length, 4, 1, 1],
      editMessageId: messageId,
    })

    const selection = await DBOS.recv<{ value: Action, messageId?: string }>(ACTION_EVENT)
    if (!selection) return
    messageId = selection.messageId ?? messageId

    if (selection.value.action === 'cancel') {
      if (messageId) await deleteMsg(ctx, messageId)
      await reply(ctx, mode === 'edit' ? 'Edição de card cancelada.' : 'Adição de card cancelada.')
      return
    }

    if (selection.value.action === 'confirm') break

    if (selection.value.action === 'rarity') {
      cardData.rarity = selection.value.value
      continue
    }

    if (selection.value.action === 'edit') {
      const field = selection.value.field
      await reply(ctx, FIELD_PROMPTS[field])
      await awaitTextReply(ctx, TEXT_EVENT)
      const textReply = await DBOS.recv<{ value: string }>(TEXT_EVENT)
      if (!textReply?.value) continue

      if (field === 'tags') {
        cardData.tags = textReply.value.trim().toLowerCase() === 'limpar'
          ? []
          : textReply.value.split(',').map(t => t.trim()).filter(Boolean)
      } else {
        cardData[field] = textReply.value.trim()
      }
    }
  }

  await finalizeCard(ctx, cardData, photoUrl, mode, existingCardId, messageId, before)
}
