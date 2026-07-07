export interface SubcommandOptions {
  name: string;
  description: string;
  isWorkflow?: boolean;
}

export function Subcommand(options: SubcommandOptions) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    if (!target.subcommands) {
      target.subcommands = {};
    }
    target.subcommands[options.name] = {
      ...options,
      methodName: propertyKey
    };
  };
}
