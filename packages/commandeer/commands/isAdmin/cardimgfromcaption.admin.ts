import { Command, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { DBOS } from '@dbos-inc/dbos-sdk'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import { uploadCardImage } from '../../services/cardImage'
import { uploadFromUrl } from '@girae/common/utilities/storage'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'

const CONFIRM_EVENT = 'confirm'

interface ParsedCaption { name: string; subcategoryName: string }

const NAME_LINE_RE = /^\S+\s+\d+\.\s*(.+)$/u

function parseCaption(text: string): ParsedCaption | null {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const nameLine = lines[0]
  const subcategoryLine = lines[1]
  if (!nameLine || !subcategoryLine) return null

  const nameMatch = nameLine.match(NAME_LINE_RE)
  if (!nameMatch) return null

  const subcategoryName = subcategoryLine.split(' ').slice(1).join(' ').trim()
  if (!subcategoryName) return null

  return { name: nameMatch[1]!.trim(), subcategoryName }
}

export default class CardImageFromCaptionCommand extends Command {
  static override info = {
    name: 'cardimgfromcaption',
    description: 'Detecta um card a partir de uma legenda (staff, uso automático em tópico dedicado)',
    usage: '/cardimgfromcaption (em uma foto com legenda no formato de listagem de card)',
    useWorkflow: true,
  }

  @DBOS.workflow()
  @CommandArgument([{ name: 'content', type: CommandArgumentType.STRING, nullable: true }])
  static override async execute(ctx: IncomingCommand, args: { content?: string }) {
    const sourceText = args.content || ctx.message.replyTo?.content
    const photoUrl = ctx.message.photoUrl ?? ctx.message.replyTo?.photoUrl
    if (!photoUrl) return

    if (!sourceText) {
      await reply(ctx, 'Não encontrei nenhuma legenda para reconhecer o card.')
      return
    }

    const parsed = parseCaption(sourceText)
    if (!parsed) {
      await reply(ctx, 'Não consegui reconhecer o nome do card e da subcategoria nessa legenda.')
      return
    }

    const subcategory = await CardsDB.getSubcategoryByName(parsed.subcategoryName)
    const matchBySubcategory = subcategory ? await CardsDB.getCardByNameAndSubcategory(parsed.name, subcategory.id) : null
    const match = matchBySubcategory ?? await CardsDB.getCardByName(parsed.name)

    if (!match) {
      await reply(ctx, `Não encontrei nenhum card chamado **${escapeMarkdown(parsed.name)}**.`)
      return
    }

    const card = await CardsDB.getCardWithDetails(match.id)
    if (!card) return

    const messageId = await reply(ctx, {
      content: `Trocar foto do card **${escapeMarkdown(card.name)}** na subcategoria **${escapeMarkdown(card.subcategoryName ?? 'desconhecida')}**?`,
      eventName: CONFIRM_EVENT,
      options: [{ title: '✅ Confirmar', data: true }, { title: '❌ Cancelar', data: false }],
    })
    const selection = await DBOS.recv<{ value: boolean, messageId?: string }>(CONFIRM_EVENT)
    const confirmedMessageId = selection?.messageId ?? messageId

    if (!selection?.value) {
      if (confirmedMessageId) await deleteMsg(ctx, confirmedMessageId)
      return
    }

    const user = await UsersDB.getUserByTelegramId(ctx.message.author.id)
    if (!user) return

    const cdnUrl = ctx.message.isAnimatedPhoto ? await uploadFromUrl(photoUrl, 'cards') : await uploadCardImage(photoUrl)
    await CardsDB.updateCard(card.id, { imageUrl: cdnUrl })
    await AuditDB.log(user.id, 'card.imageUpdate', { cardId: card.id, name: card.name })

    if (confirmedMessageId) await deleteMsg(ctx, confirmedMessageId)
    await reply(ctx, {
      content: `🃏 Imagem do card **${escapeMarkdown(card.name)}** atualizada.`,
      photoUrl: cdnUrl,
    })
  }
}
