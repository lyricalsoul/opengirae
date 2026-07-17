import { DBOS } from '@dbos-inc/dbos-sdk'
import { VanitiesDB } from '@girae/database/vanities'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply, deleteMsg, awaitTextReply } from '@girae/common/dbos/messaging'
import { uploadFromUrl } from '@girae/common/utilities/storage'
import { generateProfileImage } from '@girae/common/ditto'
import { buildProfileData } from '@girae/common/profileData'
import { inferVanityData } from './vanityInference'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { EMOJI } from '../constants'

export type VanityType = 'background' | 'sticker'

export interface VanityItemData {
  title: string
  description: string
  price: number | null
}

const TYPE_LABEL = { background: 'papel de parede', sticker: 'sticker' } as const
const TYPE_FOLDER = { background: 'backgrounds', sticker: 'stickers' } as const

type TextField = 'title' | 'description' | 'price'
type Action =
  | { action: 'edit', field: TextField }
  | { action: 'confirm' }
  | { action: 'cancel' }

const FIELD_PROMPTS: Record<TextField, string> = {
  title: 'Envie o novo nome.',
  description: 'Envie a nova descrição.',
  price: 'Envie o novo preço (em moedas).',
}

const ACTION_EVENT = 'vanitywizard:action'
const TEXT_EVENT = 'vanitywizard:text'
const DELETE_CONFIRM_EVENT = 'vanitywizard:delConfirm'

const OLD_LISTING_RE = /^.+?\s\d+\.\s*(.+)\n(.+)\n+💰\s*([\d.,]+)\s*moedas/u

function parseOldListing(content: string): VanityItemData | null {
  const match = content.match(OLD_LISTING_RE)
  if (!match) return null
  const [, title, description, priceRaw] = match
  const price = parseInt(priceRaw!.replace(/[.,]/g, ''), 10)
  return { title: title!.trim(), description: description!.trim(), price: isNaN(price) ? null : price }
}

export async function resolveInitialVanityData(ctx: IncomingCommand, type: VanityType, content: string | undefined): Promise<{ data: VanityItemData, deterministic: boolean }> {
  const fullArgsText = (content ?? '').trim()
  const listing = parseOldListing(fullArgsText) ?? (ctx.message.replyTo?.content ? parseOldListing(ctx.message.replyTo.content) : null)

  const tokens = fullArgsText ? fullArgsText.split(/\s+/) : []
  const firstArg = tokens[0]
  const asPrice = firstArg ? parseInt(firstArg, 10) : NaN
  const hasLeadingPrice = !listing && !isNaN(asPrice) && asPrice > 0
  const argsPrice = hasLeadingPrice ? asPrice : null
  const rest = (hasLeadingPrice ? tokens.slice(1) : tokens).join(' ').trim()
  const [explicitTitle, explicitDescription] = rest.split(' - ').map(s => s?.trim())

  const data: VanityItemData = {
    title: listing?.title || explicitTitle || '',
    description: listing?.description || explicitDescription || '',
    price: listing?.price ?? argsPrice,
  }
  if (data.title && data.description && data.price != null) return { data, deterministic: true }

  const fullText = [rest, ctx.message.replyTo?.content].filter(Boolean).join('\n')
  if (!fullText.trim()) return { data, deterministic: false }

  const inferred = await inferVanityData(fullText, type)
  if (!inferred) return { data, deterministic: false }

  return {
    data: {
      title: data.title || inferred.title,
      description: data.description || inferred.description,
      price: data.price ?? inferred.price,
    },
    deterministic: false,
  }
}

const VANITY_EDIT_CMD = { background: 'editbg', sticker: 'editsticker' } as const
const VANITY_DEL_CMD = { background: 'delbg', sticker: 'delsticker' } as const

const vanityActionButtons = (itemId: number, type: VanityType) => [
  { text: '✏️ Editar', runCommand: { name: VANITY_EDIT_CMD[type], args: [String(itemId)] } },
  { text: '🗑️ Deletar', runCommand: { name: VANITY_DEL_CMD[type], args: [String(itemId)] } },
]

export async function finalizeVanityItem(
  ctx: IncomingCommand,
  itemData: VanityItemData,
  photoUrl: string,
  type: VanityType,
  mode: 'create' | 'edit',
  existingItemId?: number,
  messageId?: string,
) {
  const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
  if (!user) return

  const cdnUrl = await uploadFromUrl(photoUrl, TYPE_FOLDER[type])

  if (mode === 'edit' && existingItemId) {
    const updated = await VanitiesDB.updateStoreItem(existingItemId, {
      title: itemData.title,
      description: itemData.description,
      price: itemData.price!,
      itemURL: cdnUrl,
    }).catch((e) => {
      if (e?.code === '23505') return null // unique (title, type) violated
      throw e
    })
    if (!updated) {
      if (messageId) await deleteMsg(ctx, messageId)
      await reply(ctx, `Já existe um ${TYPE_LABEL[type]} chamado **${escapeMarkdown(itemData.title)}**.`)
      return
    }

    await AuditDB.log(user.id, `vanity.${type}.edit`, { itemId: existingItemId, title: itemData.title, price: itemData.price })

    if (messageId) await deleteMsg(ctx, messageId)
    await reply(ctx, {
      content: `🛍 ${TYPE_LABEL[type]} atualizado: \`${existingItemId}\`. **${escapeMarkdown(itemData.title)}**\n${escapeMarkdown(itemData.description)}\n💸 ${itemData.price} moedas`,
      photoUrl: cdnUrl,
      buttons: vanityActionButtons(existingItemId, type),
    })
    return
  }

  const item = await VanitiesDB.createStoreItem({
    title: itemData.title,
    description: itemData.description,
    type,
    price: itemData.price!,
    itemURL: cdnUrl,
  }).catch((e) => {
    if (e?.code === '23505') return null // unique (title, type) violated - lost a race with a concurrent /add
    throw e
  })
  if (!item) {
    if (messageId) await deleteMsg(ctx, messageId)
    await reply(ctx, `Já existe um ${TYPE_LABEL[type]} chamado **${escapeMarkdown(itemData.title)}**.`)
    return
  }

  await AuditDB.log(user.id, `vanity.${type}.create`, { itemId: item.id, title: itemData.title, price: itemData.price })

  if (messageId) await deleteMsg(ctx, messageId)
  await reply(ctx, {
    content: `🛍 ${TYPE_LABEL[type]} criado: \`${item.id}\`. **${escapeMarkdown(itemData.title)}**\n${escapeMarkdown(itemData.description)}\n💸 ${itemData.price} moedas`,
    photoUrl: cdnUrl,
    buttons: vanityActionButtons(item.id, type),
  })
}

export async function addVanityItem(ctx: IncomingCommand, type: VanityType, content: string | undefined) {
  const photoUrl = ctx.message.photoUrl ?? ctx.message.replyTo?.photoUrl
  if (!photoUrl) {
    await reply(ctx, `Uso: \`/${type === 'background' ? 'addbg' : 'addsticker'} [preço] [Nome - Descrição]\`, respondendo a uma foto (ou enviando junto com a legenda). Preço e descrição podem ser preenchidos depois, no assistente.`)
    return
  }

  const { data, deterministic } = await resolveInitialVanityData(ctx, type, content)
  if (deterministic) {
    await finalizeVanityItem(ctx, data, photoUrl, type, 'create')
    return
  }

  await runVanityWizard(ctx, { itemData: data, photoUrl, type, mode: 'create' })
}

type VanityItem = NonNullable<Awaited<ReturnType<typeof VanitiesDB.getStoreItemById>>>

export async function editVanityItem(ctx: IncomingCommand, type: VanityType, item: VanityItem) {
  const newPhotoUrl = ctx.message.photoUrl ?? ctx.message.replyTo?.photoUrl
  const photoUrl = newPhotoUrl ?? item.itemURL

  await runVanityWizard(ctx, {
    itemData: { title: item.title, description: item.description, price: item.price },
    photoUrl,
    type,
    mode: 'edit',
    existingItemId: item.id,
  })
}

export async function deleteVanityItem(ctx: IncomingCommand, type: VanityType, item: VanityItem) {
  await reply(ctx, {
    content: `🗑️ Deletar **${escapeMarkdown(item.title)}** (\`${item.id}\`)? Essa ação não pode ser desfeita.`,
    photoUrl: item.itemURL,
    eventName: DELETE_CONFIRM_EVENT,
    restricted: 'author',
    options: [{ title: '✅ Confirmar', data: true }, { title: '❌ Cancelar', data: false }],
  })

  const confirmSelection = await DBOS.recv<{ value: boolean, messageId?: string }>(DELETE_CONFIRM_EVENT)
  if (confirmSelection?.messageId) await deleteMsg(ctx, confirmSelection.messageId)
  if (!confirmSelection?.value) return

  const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
  if (!user) return

  await VanitiesDB.deleteStoreItem(item.id)
  await AuditDB.log(user.id, `vanity.${type}.delete`, { itemId: item.id, title: item.title })
  await reply(ctx, `🗑️ **${escapeMarkdown(item.title)}** foi deletado.`)
}

export async function runVanityWizard(
  ctx: IncomingCommand,
  initial: { itemData: VanityItemData, photoUrl: string, type: VanityType, mode: 'create' | 'edit', existingItemId?: number }
) {
  const { photoUrl, type, mode, existingItemId } = initial
  const itemData: VanityItemData = { ...initial.itemData }

  // the ditto preview only depends on the photo, not the editable text fields
  const profileData = await buildProfileData(ctx.message.author.id, {
    backgroundURL: type === 'background' ? photoUrl : undefined,
    stickerURL: type === 'sticker' ? photoUrl : undefined,
  })
  const preview = profileData ? await generateProfileImage(profileData) : null
  if (!preview) {
    await reply(ctx, 'Erro ao gerar preview. Tente novamente em instantes.')
    return
  }

  let messageId: string | undefined
  while (true) {
    const existing = itemData.title ? await VanitiesDB.getStoreItemByTitle(itemData.title, type) : null
    const isDuplicateOfSelf = mode === 'edit' && existing?.id === existingItemId
    const priceValid = itemData.price != null && itemData.price > 0

    let warnings = ''
    if (!itemData.title) warnings += '\n🚫 Nome não definido.'
    if (!itemData.description) warnings += '\n🚫 Descrição não definida.'
    if (!priceValid) warnings += '\n🚫 Preço não definido.'
    if (existing && !isDuplicateOfSelf) warnings += `\n⚠️ Já existe um ${TYPE_LABEL[type]} chamado (\`${existing.id}\`). Confirme antes de upar novamente.`

    const priceText = priceValid ? `${itemData.price}` : '❓'
    const previewContent = `${EMOJI.dice} **${escapeMarkdown(itemData.title || 'sem nome')}**\n\n${itemData.description ? escapeMarkdown(itemData.description) : '_sem descrição_'}\n💸 ${priceText} moedas${warnings}`

    const options = [
      { title: '📓 Nome', data: { action: 'edit', field: 'title' } as Action },
      { title: '📝 Descrição', data: { action: 'edit', field: 'description' } as Action },
      { title: '💰 Preço', data: { action: 'edit', field: 'price' } as Action },
      { title: '✅ Confirmar', data: { action: 'confirm' } as Action },
      { title: '❌ Cancelar', data: { action: 'cancel' } as Action },
    ]

    await reply(ctx, {
      content: previewContent,
      photoUrl: preview.url,
      eventName: ACTION_EVENT,
      restricted: 'author',
      options,
      rows: [3, 1, 1],
      editMessageId: messageId,
    })

    const selection = await DBOS.recv<{ value: Action, messageId?: string }>(ACTION_EVENT)
    if (!selection) return
    messageId = selection.messageId ?? messageId

    if (selection.value.action === 'cancel') {
      if (messageId) await deleteMsg(ctx, messageId)
      await reply(ctx, mode === 'edit' ? `Edição de ${TYPE_LABEL[type]} cancelada.` : `Adição de ${TYPE_LABEL[type]} cancelada.`)
      return
    }

    if (selection.value.action === 'confirm') {
      if (!itemData.title || !itemData.description || !priceValid) continue // blocked, warnings above explain why
      break
    }

    if (selection.value.action === 'edit') {
      const field = selection.value.field
      await reply(ctx, FIELD_PROMPTS[field])
      await awaitTextReply(ctx, TEXT_EVENT)
      const textReply = await DBOS.recv<{ value: string }>(TEXT_EVENT)
      if (!textReply?.value) continue

      if (field === 'price') {
        const parsed = parseInt(textReply.value.trim(), 10)
        if (!isNaN(parsed) && parsed > 0) itemData.price = parsed
      } else {
        itemData[field] = textReply.value.trim()
      }
    }
  }

  await finalizeVanityItem(ctx, itemData, photoUrl, type, mode, existingItemId, messageId)
}
