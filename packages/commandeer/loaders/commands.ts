import { readdirSync } from "fs"
import { join } from "path"
import type { Command } from "@girae/common/commands"
import { Loadable } from "./base"

interface LoadedCommand {
  module: typeof Command;
  category: string;
  guards: string[]
}

interface QuickViewEntry {
  module: typeof Command;
  methodName: string;
}

interface PageEntry {
  module: typeof Command;
  methodName: string;
  restricted: boolean;
}

class CommandsLoader extends Loadable {
  protected readonly label = "commands"

  private commands: LoadedCommand[] = []
  private quickViews: Record<string, QuickViewEntry> = {}
  private pages: Record<string, PageEntry> = {}

  async init(): Promise<void> {
    const commandPath = join(__dirname, "..", "commands")

    this.commands = (await Promise.all(readdirSync(commandPath).map(async guardRaw => {
      const guards = guardRaw.split("+")
      const entries = await this.importAll(join(commandPath, guardRaw))
      return entries.map(({ file, module }) => {
        const [, category] = file.split(".")
        return { module: module as typeof Command, category, guards } as LoadedCommand
      })
    }))).flat()

    for (const cmd of this.commands) {
      const registeredQuickViews = (cmd.module as any).quickViews as Record<string, { methodName: string }> | undefined
      for (const [name, entry] of Object.entries(registeredQuickViews ?? {})) {
        this.quickViews[name] = { module: cmd.module, methodName: entry.methodName }
      }

      const registeredPages = (cmd.module as any).pages as Record<string, { methodName: string; restricted: boolean }> | undefined
      for (const [name, entry] of Object.entries(registeredPages ?? {})) {
        this.pages[name] = { module: cmd.module, methodName: entry.methodName, restricted: entry.restricted }
      }
    }

    this.logLoaded(this.commands.length)
  }

  findCommand(name: string): LoadedCommand | undefined {
    return this.commands.find(cmd =>
      cmd.module.info.name === name ||
      (cmd.module.info.aliases && cmd.module.info.aliases.includes(name))
    )
  }

  listCommands(): LoadedCommand[] {
    return this.commands
  }

  findQuickView(name: string): QuickViewEntry | undefined {
    return this.quickViews[name]
  }

  findPage(name: string): PageEntry | undefined {
    return this.pages[name]
  }
}

export const commandsLoader = new CommandsLoader()
await commandsLoader.init()

export const findCommand = commandsLoader.findCommand.bind(commandsLoader)
export const listCommands = commandsLoader.listCommands.bind(commandsLoader)
export const findQuickView = commandsLoader.findQuickView.bind(commandsLoader)
export const findPage = commandsLoader.findPage.bind(commandsLoader)
