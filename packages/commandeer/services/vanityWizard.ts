import { DBOS } from '@dbos-inc/dbos-sdk'
import { VanitiesDB } from '@girae/database/vanities'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import { uploadFromUrl } from './storage'
import { generateProfileImage } from './ditto'
import { buildProfileData } from './profileData'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const TYPE_LABEL = { background: 'papel de parede', sticker: 'sticker' } as const
const TYPE_FOLDER = { background: 'backgrounds', sticker: 'stickers' } as const

const CONFIRM_EVENT = 'addvanity:confirm'

export async function addVanityItem(ctx: IncomingCommand, type: 'background' | 'sticker') {
  const photoUrl = ctx.message.photoUrl ?? ctx.message.replyTo?.photoUrl
  const price = parseInt(ctx.args[0]!, 10)
  const rest = ctx.args.slice(1).join(' ')
  const [title, description] = rest.split(' - ').map(s => s?.trim())

  if (!photoUrl || isNaN(price) || !title || !description) {
    await reply(ctx, `Uso: \`/${type === 'background' ? 'addbg' : 'addsticker'} <preço> Nome - Descrição\`, respondendo a uma foto (ou enviando junto com a legenda).`)
    return
  }

  const existing = await VanitiesDB.getStoreItemByTitle(title, type)
  if (existing) {
    await reply(ctx, `Já existe um ${TYPE_LABEL[type]} chamado **${escapeMarkdown(title)}**.`)
    return
  }

  const profileData = await buildProfileData(ctx.message.author.id, {
    backgroundURL: type === 'background' ? photoUrl : undefined,
    stickerURL: type === 'sticker' ? photoUrl : undefined,
  })
  const preview = profileData ? await generateProfileImage(profileData) : null

  await reply(ctx, {
    content: `**${escapeMarkdown(title)}** — ${escapeMarkdown(description)}\n💸 ${price} moedas\n\nConfirma a criação deste ${TYPE_LABEL[type]}?`,
    photoUrl: preview?.url ?? photoUrl,
    eventName: CONFIRM_EVENT,
    restricted: 'author',
    options: [{ title: '✅ Confirmar', data: true }, { title: '❌ Cancelar', data: false }],
  })

  const confirmSelection = await DBOS.recv<{ value: boolean, messageId?: string }>(CONFIRM_EVENT)
  if (!confirmSelection?.value) {
    if (confirmSelection?.messageId) await deleteMsg(ctx, confirmSelection.messageId)
    return
  }

  const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
  if (!user) return

  const cdnUrl = await uploadFromUrl(photoUrl, TYPE_FOLDER[type])
  const item = await VanitiesDB.createStoreItem({ title, description, type, price, itemURL: cdnUrl }).catch((e) => {
    if (e?.code === '23505') return null // unique (title, type) violated - lost a race with a concurrent /add
    throw e
  })
  if (!item) {
    await reply(ctx, `Já existe um ${TYPE_LABEL[type]} chamado **${escapeMarkdown(title)}**.`)
    return
  }

  await AuditDB.log(user.id, `vanity.${type}.create`, { itemId: item.id, title, price })

  if (confirmSelection.messageId) await deleteMsg(ctx, confirmSelection.messageId)
  await reply(ctx, {
    content: `🛍 ${TYPE_LABEL[type]} criado: \`${item.id}\`. **${escapeMarkdown(title)}**\n${escapeMarkdown(description)}\n💸 ${price} moedas`,
    photoUrl: cdnUrl,
  })
}
