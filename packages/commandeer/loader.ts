import { info } from "@girae/common/logger";
import { readdirSync } from "fs"
import { join } from "path"
import type { CommandContext } from "@girae/common/commands";
import { setAvailableCommands } from "@girae/common/consensus";

interface CommandModule {
  name: string;
  alias?: string[];
  description: string;
  execute: (ctx: CommandContext) => Promise<void>;
}

interface LoadedCommand {
  module: CommandModule;
  category: string;
  guards: string[]
}

const commandPath = join(__dirname, "commands")

const loadedCommands = await Promise.all(readdirSync(commandPath).map(async (guardRaw) => {
  const guards = guardRaw.split("+")

  return Promise.all(readdirSync(join(commandPath, guardRaw)).map(async (file) => {
    const filePath = join(commandPath, guardRaw, file);
    const module = await import(filePath);
    const [name, category, _] = file.split(".");

    return {
      module: module as CommandModule,
      category,
      guards
    } as LoadedCommand;
  }))
})).then(a => a.flat())

info("commandeer", `Loaded ${loadedCommands.length} commands`)

const names = loadedCommands.map(cmd => cmd.module.name)
const aliases = loadedCommands.flatMap(cmd => cmd.module.alias ?? [])
const allNames = new Set([...names, ...aliases])

setAvailableCommands([...allNames]).then(() => info("commandeer", `Registered ${allNames.size} commands`))

export const findCommand = (name: string): LoadedCommand | undefined => {
  return loadedCommands.find(cmd =>
    cmd.module.name === name ||
    (cmd.module.alias && cmd.module.alias.includes(name))
  );
};
