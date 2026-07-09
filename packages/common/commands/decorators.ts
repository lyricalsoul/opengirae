export interface SubcommandOptions {
  name: string;
  description: string;
  isWorkflow?: boolean;
  aliases?: string[];
}

export function Subcommand(options: SubcommandOptions) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    if (!target.subcommands) {
      target.subcommands = {};
    }
    const entry = {
      ...options,
      methodName: propertyKey
    };
    target.subcommands[options.name] = entry;
    for (const alias of options.aliases ?? []) {
      target.subcommands[alias] = entry;
    }
  };
}
