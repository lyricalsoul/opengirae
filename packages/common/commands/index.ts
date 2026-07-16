import type { IncomingCommand } from "./types/messaging"
export * from "./decorators"

interface CommandInfo {
  name: string;
  description: string;
  usage?: string;
  aliases?: string[];
  useWorkflow?: boolean;
}

export class Command {
  static info: CommandInfo = {
    name: 'unimplemented',
    description: 'Unimplemented command',
  }

  static async execute(ctx: IncomingCommand, args?: any) {
    throw new Error('Unimplemented')
  }
}
