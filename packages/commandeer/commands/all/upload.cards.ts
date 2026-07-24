import { Command, QuickView, CommandArgument, CommandArgumentType } from '@girae/common/commands'
import { reply, deleteMsg } from '@girae/common/dbos/messaging'
import { CardsDB } from '@girae/database/cards'
import { UsersDB } from '@girae/database/users'
import { AuditDB } from '@girae/database/audit'
import { uploadFromUrl } from '@girae/common/utilities/storage'
import type { IncomingCommand } from '@girae/common/commands/types'
import { escapeMarkdown } from '@girae/common/utilities/markdown'
import { mention } from '@girae/common/utilities/mention'
import { buildCtx } from '../../services/syntheticCtx'
import { cativeiroEligibilityGuard, MAX_UPLOAD_BYTES } from '../../services/cativeiro'
import type { cardCustomizationSubmissions } from '@girae/database/schemas/cards'

type CardDetails = NonNullable<Awaited<ReturnType<typeof CardsDB.getCardWithDetails>>>
type Submission = typeof cardCustomizationSubmissions.$inferSelect

const REVIEW_CHAT_ID = '-1003993142790'
const REVIEW_THREAD_ID = '82150'

// Shared by cativeiroApprove/cativeiroReject: delete the original submission message and
// post a fresh decision message in its place, in the same topic, with the media attached.
async function postDecisionMessage(
  submission: Submission, card: CardDetails | undefined,
  verb: 'aprovou' | 'rejeitou', hashtagPrefix: 'APROVAÇÃO' | 'REJEIÇÃO',
  reviewerName: string, clickerUserId: string, platform: 'telegram' | 'discord',
) {
  const isVideo = submission.mediaType === 'video'
  const hashtag = `#${hashtagPrefix}_DE_${isVideo ? 'VÍDEO' : 'FOTO'}`
  const mediaLabel = isVideo ? 'o vídeo customizado' : 'a imagem customizada'
  const reviewerMention = mention(platform, clickerUserId, reviewerName)
  const submitterMention = mention(submission.submitterPlatform as 'telegram' | 'discord', submission.submitterPlatformId, submission.submitterName)

  const reviewCtx = buildCtx('telegram', clickerUserId, reviewerName, submission.reviewChatId ?? REVIEW_CHAT_ID, REVIEW_THREAD_ID)
  if (submission.reviewMessageId) await deleteMsg(reviewCtx, submission.reviewMessageId)

  await reply(reviewCtx, {
    content: `🖼️ ${hashtag}\n\n👮🏼 ${reviewerMention} ${verb} ${mediaLabel} de ${submitterMention} para o card ${card?.rarityEmoji ?? ''} \`${submission.cardId}\`. **${escapeMarkdown(card?.name ?? '?')}**.`,
    photoUrl: submission.mediaUrl,
    isVideo,
  })
}

export default class UploadCommand extends Command {
  static override info = {
    name: 'upload',
    description: 'Envia um vídeo/foto para personalizar um card elegível para cativeiro',
    usage: '/upload <id do card> (quotando um vídeo ou foto)',
  }

  @CommandArgument([{ name: 'card', type: CommandArgumentType.CARD, guard: cativeiroEligibilityGuard, nullable: true }])
  static override async execute(ctx: IncomingCommand, args: { card?: CardDetails }) {
    if (!args.card) {
      await reply(ctx, '📌 Use `/upload id` respondendo a uma foto ou vídeo de até 50 MB para personalizar seu card!\n\n🎥 Vídeos devem estar nos formatos 9:16 ou 3:4.\n🖼️ Fotos devem estar no formato 3:4.\n\n✨ Para personalizar seu card com um emoji, use `/emojicard id emoji`.')
      return
    }

    const source = ctx.message.photoUrl ? ctx.message : ctx.message.replyTo

    // Checked before even looking at photoUrl: Telegram's own getFile can fail outright
    // for a huge file, so fileSizeBytes (known upfront, no fetch needed) may be the only
    // thing we have - and it's already enough to reject with a real message instead of
    // falling through to "não encontrei nenhuma mídia".
    if ((source?.fileSizeBytes ?? 0) > MAX_UPLOAD_BYTES) {
      await reply(ctx, '😔 Essa mídia passa de 50 MB e eu não posso aceitar ela... Tenta comprimir ou enviar uma versão mais leve?')
      return
    }

    const photoUrl = source?.photoUrl
    if (!photoUrl) {
      await reply(ctx, '😔 Não encontrei nenhum vídeo ou foto. Responda a mensagem com a mídia e tente de novo!')
      return
    }

    const isVideo = !!source?.isVideo

    const user = await UsersDB.getUserByPlatformAccount(ctx.message.platform as 'telegram' | 'discord', ctx.message.author.id)
    if (!user) return

    const cdnUrl = await uploadFromUrl(photoUrl, 'cativeiro')
    const mediaType = isVideo ? 'video' as const : 'photo' as const

    const result = await CardsDB.createCativeiroSubmission(user.id, args.card.id, cdnUrl, mediaType, {
      platform: ctx.message.platform,
      platformId: ctx.message.author.id,
      name: ctx.message.author.name,
      chatId: ctx.message.chat.id,
      threadId: ctx.message.chat.threadId,
    })
    if (!result.ok || !result.submission) {
      await reply(ctx, 'Você já tem uma submissão pendente para esse card! Aguarde nossa equipe revisar antes de enviar outra. 💌')
      return
    }

    const reviewCtx = buildCtx('telegram', ctx.message.author.id, ctx.message.author.name, REVIEW_CHAT_ID, REVIEW_THREAD_ID)
    const reviewMessageId = await reply(reviewCtx, {
      content: `📸 \`${user.id}\`. ${mention(ctx.message.platform, ctx.message.author.id, ctx.message.author.name)} enviou ${isVideo ? 'um vídeo personalizado' : 'uma imagem personalizada'} para o card ${args.card.rarityEmoji} \`${args.card.id}\`. **${escapeMarkdown(args.card.name)}**!\n\nAprove clicando em ✅ Aprovar, ou rejeite usando ❌ Rejeitar.`,
      photoUrl: cdnUrl,
      isVideo,
      buttons: [
        { text: '✅ Aprovar', quickView: { handler: 'cativeiroApprove', arg: String(result.submission.id) }, color: 'success' },
        { text: '❌ Rejeitar', quickView: { handler: 'cativeiroReject', arg: String(result.submission.id) }, color: 'danger' },
      ],
    })
    if (reviewMessageId) await CardsDB.setCativeiroSubmissionReviewMessage(result.submission.id, REVIEW_CHAT_ID, reviewMessageId)

    await reply(ctx, `📮 Recebemos sua submissão do card ${args.card.rarityEmoji} \`${args.card.id}\`. **${escapeMarkdown(args.card.name)}**! Nossa equipe vai revisar e te aviso no privado assim que tiver novidades.`)
  }

  @QuickView({ name: 'cativeiroApprove' })
  static async cativeiroApprove(arg: string, clickerUserId: string, platform: 'telegram' | 'discord'): Promise<string> {
    const submissionId = parseInt(arg, 10)
    if (isNaN(submissionId)) return 'Erro ao processar.'

    const reviewer = await UsersDB.getUserByPlatformAccount(platform, clickerUserId)
    if (!reviewer) return 'Erro ao processar.'

    const result = await CardsDB.approveCativeiroSubmission(submissionId)
    if (!result.ok) return '⚠️ Essa submissão já foi revisada.'

    const { submission } = result
    await AuditDB.log(reviewer.id, 'cativeiro.approve', { submissionId, cardId: submission.cardId, userId: submission.userId })

    const card = await CardsDB.getCardWithDetails(submission.cardId)
    await postDecisionMessage(submission, card, 'aprovou', 'APROVAÇÃO', reviewer.displayName, clickerUserId, platform)

    // Exclusively the player's own private chat - never wherever they happened to run
    // /upload from (that could be a group). A Telegram/Discord private chat's id is the
    // user's own platform id.
    const dm = buildCtx(submission.submitterPlatform as 'telegram' | 'discord', submission.submitterPlatformId, submission.submitterName, submission.submitterPlatformId)
    await reply(dm, {
      content: `🎉 Parabéns! Seu card ${card?.rarityEmoji ?? ''} \`${submission.cardId}\`. **${escapeMarkdown(card?.name ?? '?')}** foi personalizado com sucesso!`,
      photoUrl: submission.mediaUrl,
      isVideo: submission.mediaType === 'video',
    })

    return '✅ Aprovado!'
  }

  @QuickView({ name: 'cativeiroReject' })
  static async cativeiroReject(arg: string, clickerUserId: string, platform: 'telegram' | 'discord'): Promise<string> {
    const submissionId = parseInt(arg, 10)
    if (isNaN(submissionId)) return 'Erro ao processar.'

    const reviewer = await UsersDB.getUserByPlatformAccount(platform, clickerUserId)
    if (!reviewer) return 'Erro ao processar.'

    const result = await CardsDB.rejectCativeiroSubmission(submissionId)
    if (!result.ok) return '⚠️ Essa submissão já foi revisada.'

    const { submission } = result
    await AuditDB.log(reviewer.id, 'cativeiro.reject', { submissionId, cardId: submission.cardId, userId: submission.userId })

    const card = await CardsDB.getCardWithDetails(submission.cardId)
    await postDecisionMessage(submission, card, 'rejeitou', 'REJEIÇÃO', reviewer.displayName, clickerUserId, platform)

    const dm = buildCtx(submission.submitterPlatform as 'telegram' | 'discord', submission.submitterPlatformId, submission.submitterName, submission.submitterPlatformId)
    await reply(dm, `😔 Hmm, sua submissão para o card ${card?.rarityEmoji ?? ''} \`${submission.cardId}\`. **${escapeMarkdown(card?.name ?? '?')}** não seguiu o formato aceito para ser personalizado.\n\nDá uma olhadinha nas dimensões pedidas em /upload e tenta de novo!`)

    return '❌ Rejeitado.'
  }
}
