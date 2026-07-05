import type { CommandContext } from '@girae/common/commands'

export const name = 'ping'
export const description = 'Verifica se a Giraê está online'

export async function execute(ctx: CommandContext) {
  await ctx.reply('Pong!')
}
