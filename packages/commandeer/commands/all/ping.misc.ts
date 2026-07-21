import { Command, Subcommand } from '@girae/common/commands'
import { reply } from '@girae/common/dbos/messaging'
import { commandQueue, responseQueue } from '@girae/common/queue'
import { getDittoMetadata } from '@girae/common/ditto'
import { commitShortSha, commitMessage, REPO_URL } from '@girae/common/version'
import type { IncomingCommand } from '@girae/common/commands/types'

const BACKLOG_SLOW_THRESHOLD = 20
const BACKLOG_DOWN_THRESHOLD = 100

async function backlogStatus(): Promise<{ emoji: string; label: string }> {
  const [commandCounts, responseCounts] = await Promise.all([
    commandQueue.getJobCounts('waiting', 'active'),
    responseQueue.getJobCounts('waiting', 'active'),
  ])
  const pending = commandCounts.waiting! + commandCounts.active! + responseCounts.waiting! + responseCounts.active!

  if (pending > BACKLOG_DOWN_THRESHOLD) return { emoji: '🔴', label: 'INTERRUPÇÃO' }
  if (pending > BACKLOG_SLOW_THRESHOLD) return { emoji: '🟡', label: 'POSSÍVEL LENTIDÃO' }
  return { emoji: '🟢', label: 'OK' }
}

export default class PingCommand extends Command {
  static override info = {
    name: 'ping',
    description: 'Verifica se o bot está online',
    usage: '/ping',
    aliases: ['pong'],
    discordEntrypointName: 'check',
  }

  static override async execute(cmd: IncomingCommand) {
    const [status, dittoMetadata] = await Promise.all([backlogStatus(), getDittoMetadata()])
    const dittoLine = dittoMetadata
      ? `🖼 Gerador de imagem: 🟢 online (${dittoMetadata.engine} v${dittoMetadata.scheme})`
      : `🖼 Gerador de imagem: 🔴 offline`
    const commitLine = commitShortSha ? `📦 Commit: \`${commitShortSha}\` ${commitMessage ?? ''}`.trim() : undefined

    await reply(cmd, {
      content: [`🤖 Status da bot: ${status.emoji} ${status.label}`, dittoLine, commitLine].filter(Boolean).join('\n'),
      buttons: [{ text: '💻 Veja o código-fonte da Giraê', url: REPO_URL }],
    })
  }

  @Subcommand({ name: 'pong', description: 'Replies with ping' })
  static async pongSub(cmd: IncomingCommand) {
    await reply(cmd, '🏓 gnoP')
  }
}
