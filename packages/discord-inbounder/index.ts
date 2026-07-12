import type { MessageAuthor, MessageChat, Message } from '@girae/common/commands/types'
import { avatarUrl, createBot, GatewayIntents } from 'discordeno'
import { processCommand } from '@girae/common/inbound/handler'
import { info } from '@girae/common/logger'

const bot = createBot({
  token: process.env.DISCORD_TOKEN!,
  intents: GatewayIntents.Guilds | GatewayIntents.MessageContent | GatewayIntents.GuildMessages,
  desiredProperties: {
    user: {
      id: true,
      globalName: true,
      avatar: true,
      accentColor: true,
      discriminator: true
    },
    message: {
      content: true,
      id: true,
      channelId: true,
      author: true,
    },
    channel: {
      id: true,
      name: true
    },
  },
  events: {
    ready: ({ shardId, user }) => info('discord-inbounder', `Shard ${shardId} ready, user id: ${user.id}`),
    messageCreate: async (msg) => {
      if (!msg.author) return

      const author: MessageAuthor = {
        id: msg.author.id.toString(),
        name: msg.author.globalName!,
        avatarUrl: avatarUrl(msg.author.id, msg.author.discriminator)
      }

      const chan = await bot.rest.getChannel(msg.channelId)

      const chat: MessageChat = {
        id: msg.channelId.toString(),
        title: chan.name!
      }

      const m: Message = {
        content: msg.content.replace('!', '/'),
        id: String(msg.id),
        author,
        chat,
        timestamp: new Date(msg.timestamp),
        platform: 'discord'
      }

      await processCommand(m)
    }
  },
})

await bot.start()
