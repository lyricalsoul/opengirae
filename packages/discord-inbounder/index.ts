import type { MessageAuthor, MessageChat, Message, IncomingCommand } from '@girae/common/commands/types'
import { avatarUrl, createBot, GatewayIntents, InteractionTypes, InteractionResponseTypes, ActivityTypes, MessageFlags } from 'discordeno'
import { processCallback } from '@girae/common/inbound/callback'
import { commandQueue } from '@girae/common/queue'
import { info, error } from '@girae/common/logger'
import { buildApplicationCommands } from './registerCommands'
import { UsersDB } from '@girae/database/users'
import { findCommand } from '@girae/commandeer/loader'

const bot = createBot({
  token: process.env.DISCORD_TOKEN!,
  intents: GatewayIntents.Guilds,
  gateway: {
    makePresence: async () => ({
      since: null,
      status: 'online',
      activities: [{ name: 'underscores', type: ActivityTypes.Listening }],
    }),
  },
  desiredProperties: {
    user: {
      id: true,
      globalName: true,
      avatar: true,
      accentColor: true,
      discriminator: true,
    },
    member: {
      user: true,
    },
    message: {
      id: true,
    },
    channel: {
      id: true,
      name: true,
    },
    interaction: {
      id: true,
      type: true,
      token: true,
      channelId: true,
      guildId: true,
      data: true,
      member: true,
      user: true,
      message: true,
    },
  },
  events: {
    ready: async ({ shardId, user }) => {
      info('discord-inbounder', `Shard ${shardId} ready, user id: ${user.id}`)

      try {
        const commands = buildApplicationCommands()
        const devGuildId = process.env.DISCORD_DEV_GUILD_ID
        if (devGuildId) {
          await bot.helpers.upsertGuildApplicationCommands(BigInt(devGuildId), commands)
          info('discord-inbounder', `Registered ${commands.length} application commands on guild ${devGuildId}`)
        } else {
          await bot.helpers.upsertGlobalApplicationCommands(commands)
          info('discord-inbounder', `Registered ${commands.length} application commands globally`)
        }
      } catch (e) {
        error('discord-inbounder', `Failed to register application commands: ${e}`)
      }
    },

    interactionCreate: async (interaction) => {
      const invokingUser = interaction.member?.user ?? interaction.user
      if (!invokingUser || !interaction.channelId) return

      const author: MessageAuthor = {
        id: invokingUser.id.toString(),
        name: invokingUser.globalName ?? 'unknown',
        avatarUrl: avatarUrl(invokingUser.id, invokingUser.discriminator, { avatar: invokingUser.avatar }),
      }
      const chat: MessageChat = { id: interaction.channelId.toString(), title: '' }

      UsersDB.touchUsername('discord', author.id, undefined, author.name, author.avatarUrl).catch(() => undefined)

      if (interaction.type === InteractionTypes.ApplicationCommand) {
        if (!interaction.data?.name) return
        const commandName = interaction.data.name

        // Ack within Discord's 3s window - ephemeral-ness can only be set here, not on later edits.
        const ephemeral = findCommand(commandName)?.module.info.ephemeral
        await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
          type: InteractionResponseTypes.DeferredChannelMessageWithSource,
          data: ephemeral ? { flags: MessageFlags.Ephemeral } : undefined,
        })
        const placeholder = await bot.helpers.getOriginalInteractionResponse(interaction.token)

        // options arrive typed - stringify in the order registerCommands.ts declared them.
        const args = (interaction.data.options ?? []).map(o => String(o.value ?? ''))

        const message: Message = {
          id: String(placeholder.id),
          author,
          chat,
          content: `/${commandName}`,
          timestamp: new Date(),
          platform: 'discord',
          interactionToken: interaction.token,
        }

        await commandQueue.add('executeCommand', {
          name: commandName,
          args,
          message,
          workflowIDToBeAssigned: Bun.randomUUIDv7(),
        } satisfies IncomingCommand)
        return
      }

      if (interaction.type === InteractionTypes.MessageComponent) {
        const customId = interaction.data?.customId
        if (!customId || !interaction.message?.id) return

        await processCallback(
          customId,
          author.id,
          `${interaction.id}:${interaction.token}`,
          'discord',
          chat.id,
          String(interaction.message.id),
          author.name,
        )
      }
    },
  },
})

await bot.start()
