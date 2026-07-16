import { Command, QuickView, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { VanitiesDB } from '@girae/database/vanities'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import { buildProfileData } from '../../services/profileData'
import { generateProfileImage } from '../../services/ditto'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const TYPE_LABEL = { background: 'papel de parede', sticker: 'sticker' } as const
const EQUIP_FIELD = { background: 'equipedBackgroundId', sticker: 'equipedStickerId' } as const
const CONFIRM_EVENT = 'comprar:confirm'

export default class ComprarCommand extends Command {
  static override info = {
    name: 'comprar',
    description: 'Compra um item da loja',
    usage: '/comprar <ID do item>',
    useWorkflow: true
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'itemId', type: CommandArgumentType.NUMBER }])
  static override async execute(ctx: IncomingCommand, args: { itemId: number }) {
    const item = await VanitiesDB.getStoreItemById(args.itemId)
    if (!item || !item.isAvailable || item.type === 'profile') {
      await reply(ctx, 'Item não encontrado.')
      return
    }

    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) return

    if (await VanitiesDB.hasBought(user.id, item.id)) {
      await reply(ctx, `Você já possui **${escapeMarkdown(item.title)}**.`)
      return
    }

    const overrides = item.type === 'background' ? { backgroundURL: item.itemURL } : { stickerURL: item.itemURL }
    const profileData = await buildProfileData(ctx.message.author.id, overrides)
    const preview = profileData ? await generateProfileImage(profileData, ['preview']) : null

    await reply(ctx, {
      content: `**${escapeMarkdown(item.title)}** — ${escapeMarkdown(item.description)}\n💸 ${item.price} moedas\n\nConfirma a compra deste ${TYPE_LABEL[item.type]}?`,
      photoUrl: preview?.url ?? item.itemURL,
      eventName: CONFIRM_EVENT,
      restricted: 'author',
      options: [{ title: '✅ Confirmar', data: true }, { title: '❌ Cancelar', data: false }],
    })

    const confirmSelection = await DBOS.recv<{ value: boolean, messageId?: string }>(CONFIRM_EVENT)
    if (!confirmSelection?.value) {
      if (confirmSelection?.messageId) await deleteMsg(ctx, confirmSelection.messageId)
      return
    }

    const result = await VanitiesDB.purchaseItem(user.id, item.id, item.price).catch((e) => {
      if (e?.code === '23505') return { ok: false as const, reason: 'already_owned' as const } // lost a race with a concurrent purchase of the same item
      throw e
    })
    if (!result.ok) {
      if (confirmSelection.messageId) await deleteMsg(ctx, confirmSelection.messageId)
      await reply(ctx, result.reason === 'insufficient_funds' ? 'Moedas insuficientes.' : `Você já possui **${escapeMarkdown(item.title)}**.`)
      return
    }

    await AuditDB.log(user.id, 'vanity.purchase', { itemId: item.id, title: item.title, price: item.price, type: item.type })

    if (confirmSelection.messageId) await deleteMsg(ctx, confirmSelection.messageId)
    await reply(ctx, {
      content: `🛍 Você comprou **${escapeMarkdown(item.title)}**!\n💸 -${item.price} moedas`,
      photoUrl: item.itemURL,
      buttons: [{ text: '✅ Equipar agora', quickView: { handler: 'equip', arg: `${item.type}:${item.id}` } }],
    })
  }

  @QuickView({ name: 'equip' })
  static async equip(arg: string, clickerUserId: string): Promise<string> {
    const [type, itemIdStr] = arg.split(':') as ['background' | 'sticker', string]
    const itemId = parseInt(itemIdStr ?? '', 10)
    if (!EQUIP_FIELD[type] || isNaN(itemId)) return 'Erro ao equipar.'

    const user = await UsersDB.getUserByTelegramId(clickerUserId)
    if (!user) return 'Erro ao equipar.'

    if (!(await VanitiesDB.hasBought(user.id, itemId))) return 'Você não possui este item.'

    const item = await VanitiesDB.getStoreItemById(itemId)
    if (!item) return 'Item não encontrado.'

    await UsersDB.updateUserProfile(user.id, { [EQUIP_FIELD[type]]: itemId })
    return `✅ ${item.title} equipado!`
  }
}
