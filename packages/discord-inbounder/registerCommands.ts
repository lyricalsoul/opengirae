import { listCommands } from '@girae/commandeer/loader'
import { CommandArgumentType, type CommandArgumentSpec } from '@girae/common/commands'
import { ApplicationCommandOptionTypes } from 'discordeno'
import type { CreateApplicationCommand } from 'discordeno'

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

type DiscordOption = { name: string; description: string; type: ApplicationCommandOptionTypes; required?: boolean }

const OPTION_OVERRIDES: Record<string, DiscordOption[]> = {
  wish: [{ name: 'card', description: 'ID ou nome do card', type: ApplicationCommandOptionTypes.String, required: false }],
}

const toOptionName = (name: string) => name.replace(/([A-Z])/g, '_$1').toLowerCase()

function optionsFor(commandName: string, specs: CommandArgumentSpec[] | undefined): DiscordOption[] | undefined {
  if (OPTION_OVERRIDES[commandName]) return OPTION_OVERRIDES[commandName]
  if (!specs?.length) return undefined
  return specs.map(spec => ({
    name: toOptionName(spec.name),
    description: spec.name,
    type: OPTION_TYPE_MAP[spec.type],
    required: !spec.nullable,
  }))
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
    })
  }

  return commands
}
