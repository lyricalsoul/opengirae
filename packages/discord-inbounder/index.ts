import type { MessageAuthor, MessageChat, Message, IncomingCommand } from '@girae/common/commands/types'
import { avatarUrl, createBot, GatewayIntents, InteractionTypes, InteractionResponseTypes, ActivityTypes, MessageFlags, ApplicationCommandOptionTypes } from 'discordeno'
import { processCallback } from '@girae/common/inbound/callback'
import { commandQueue } from '@girae/common/queue'
import { info, error } from '@girae/common/logger'
import { startHealthServer } from '@girae/common/health'
import { buildApplicationCommands, findArgumentSpec, searchChoicesFor } from './registerCommands'
import { UsersDB } from '@girae/database/users'
import { findCommand } from '@girae/commandeer/loader'

startHealthServer(parseInt(process.env.PORT ?? '8080', 10))

function unwrapSubcommand(options: { name: string; type: number; options?: any[] }[] | undefined) {
  const subcommand = options?.[0]?.type === ApplicationCommandOptionTypes.SubCommand ? options[0] : undefined
  return { subcommandName: subcommand?.name, options: (subcommand ? subcommand.options : options) ?? [] }
}

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
      if (interaction.type === InteractionTypes.ApplicationCommandAutocomplete) {
        const commandName = interaction.data?.name
        if (!commandName) return
        const { subcommandName, options } = unwrapSubcommand(interaction.data?.options)
        const focused = options.find(o => o.focused)
        if (!focused) return

        const spec = findArgumentSpec(commandName, focused.name, subcommandName)
        const choices = spec ? await searchChoicesFor(spec, String(focused.value ?? '')) : []
        await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
          type: InteractionResponseTypes.ApplicationCommandAutocompleteResult,
          data: { choices },
        })
        return
      }

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
        const commandModule = findCommand(commandName)?.module

        const ephemeral = commandModule?.info.ephemeral
        await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
          type: InteractionResponseTypes.DeferredChannelMessageWithSource,
          data: ephemeral ? { flags: MessageFlags.Ephemeral } : undefined,
        })
        const placeholder = await bot.helpers.getOriginalInteractionResponse(interaction.token)

        const { subcommandName, options } = unwrapSubcommand(interaction.data.options)
        const isEntrypoint = subcommandName && subcommandName === commandModule?.info.discordEntrypointName
        const args = [...(subcommandName && !isEntrypoint ? [subcommandName] : []), ...options.map(o => String(o.value ?? ''))]

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
