import { info } from "@girae/common/logger";
import { readdirSync } from "fs"
import { join } from "path"
import type { Command } from "@girae/common/commands";

interface LoadedCommand {
  module: typeof Command;
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
      module: module.default as typeof Command,
      category,
      guards
    } as LoadedCommand;
  }))
})).then(a => a.flat())

info("commandeer", `Loaded ${loadedCommands.length} commands`)


const names = loadedCommands.map(cmd => cmd.module.info.name)
const aliases = loadedCommands.flatMap(cmd => cmd.module.info.aliases ?? [])

export const findCommand = (name: string): LoadedCommand | undefined => {
  return loadedCommands.find(cmd =>
    cmd.module.info.name === name ||
    (cmd.module.info.aliases && cmd.module.info.aliases.includes(name))
  );
};
