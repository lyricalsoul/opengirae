import { listCommands, findCommand } from '@girae/commandeer/loader'
import { CommandArgumentType, type CommandArgumentSpec } from '@girae/common/commands'
import { ApplicationCommandOptionTypes, DiscordApplicationIntegrationType, DiscordInteractionContextType } from 'discordeno'
import type { CreateApplicationCommand } from 'discordeno'
import { CardsDB } from '@girae/database/cards'
import { VanitiesDB } from '@girae/database/vanities'

const OPTION_TYPE_MAP: Record<CommandArgumentType, ApplicationCommandOptionTypes> = {
  [CommandArgumentType.CARD]: ApplicationCommandOptionTypes.String,
  [CommandArgumentType.CATEGORY]: ApplicationCommandOptionTypes.String,
  [CommandArgumentType.SUBCATEGORY]: ApplicationCommandOptionTypes.String,
  [CommandArgumentType.VANITY_ITEM]: ApplicationCommandOptionTypes.String,
  [CommandArgumentType.STRING]: ApplicationCommandOptionTypes.String,
  [CommandArgumentType.HEX_COLOR]: ApplicationCommandOptionTypes.String,
  [CommandArgumentType.NUMBER]: ApplicationCommandOptionTypes.Number,
  [CommandArgumentType.BOOLEAN]: ApplicationCommandOptionTypes.Boolean,
  [CommandArgumentType.USER_MENTION]: ApplicationCommandOptionTypes.User,
}

const AUTOCOMPLETE_TYPES = new Set([
  CommandArgumentType.CARD,
  CommandArgumentType.CATEGORY,
  CommandArgumentType.SUBCATEGORY,
  CommandArgumentType.VANITY_ITEM,
])

type DiscordOption = { name: string; description: string; type: ApplicationCommandOptionTypes; required?: boolean; autocomplete?: boolean }

const OPTION_OVERRIDES: Record<string, DiscordOption[]> = {
  wish: [{ name: 'card', description: 'ID ou nome do card', type: ApplicationCommandOptionTypes.String, required: false }],
}

const toOptionName = (name: string) => name.replace(/([A-Z])/g, '_$1').toLowerCase()

function optionsFor(commandName: string, specs: CommandArgumentSpec[] | undefined): DiscordOption[] | undefined {
  if (OPTION_OVERRIDES[commandName]) return OPTION_OVERRIDES[commandName]
  if (!specs?.length) return undefined
  return specs.map(spec => ({
    name: toOptionName(spec.name),
    description: spec.description ?? spec.name,
    type: OPTION_TYPE_MAP[spec.type],
    required: !spec.nullable,
    autocomplete: AUTOCOMPLETE_TYPES.has(spec.type) || undefined,
  }))
}

export function findArgumentSpec(commandName: string, discordOptionName: string): CommandArgumentSpec | undefined {
  const cmd = findCommand(commandName)
  if (!cmd) return undefined
  const specs: CommandArgumentSpec[] | undefined = (cmd.module as any).commandArguments?.['execute']
  return specs?.find(spec => toOptionName(spec.name) === discordOptionName)
}

export async function searchChoicesFor(spec: CommandArgumentSpec, query: string): Promise<{ name: string; value: string }[]> {
  switch (spec.type) {
    case CommandArgumentType.CARD: {
      const results = await CardsDB.searchCardsByName(query, 25)
      return results.map(c => ({ name: c.name.slice(0, 100), value: String(c.id) }))
    }
    case CommandArgumentType.CATEGORY: {
      const results = await CardsDB.searchCategoriesByName(query, 25)
      return results.map(c => ({ name: c.name.slice(0, 100), value: String(c.id) }))
    }
    case CommandArgumentType.SUBCATEGORY: {
      const results = await CardsDB.searchSubcategoriesByName(query, 25)
      return results.map(s => ({ name: s.name.slice(0, 100), value: String(s.id) }))
    }
    case CommandArgumentType.VANITY_ITEM: {
      const results = await VanitiesDB.searchStoreItemsByType(spec.vanityType, query, 25)
      return results.map(i => ({ name: i.title.slice(0, 100), value: String(i.id) }))
    }
    default:
      return []
  }
}

export function buildApplicationCommands(): CreateApplicationCommand[] {
  const commands: CreateApplicationCommand[] = []

  for (const { module, guards } of listCommands()) {
    if (!guards.includes('all')) continue // staff-only commands stay out of the public slash-command list

    const info = module.info
    if (info.name === 'unimplemented') continue

    const specs: CommandArgumentSpec[] | undefined = (module as any).commandArguments?.['execute']
    commands.push({
      name: info.name,
      description: info.description || info.name,
      options: optionsFor(info.name, specs),
      integrationTypes: [DiscordApplicationIntegrationType.GuildInstall, DiscordApplicationIntegrationType.UserInstall],
      contexts: [DiscordInteractionContextType.Guild, DiscordInteractionContextType.BotDm, DiscordInteractionContextType.PrivateChannel],
    })
  }

  return commands
}
