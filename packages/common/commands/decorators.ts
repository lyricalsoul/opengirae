export enum CommandArgumentType {
  CARD = 'CARD',
  CATEGORY = 'CATEGORY',
  SUBCATEGORY = 'SUBCATEGORY',
  VANITY_ITEM = 'VANITY_ITEM',
  USER_MENTION = 'USER_MENTION',
  NUMBER = 'NUMBER',
  STRING = 'STRING',
  HEX_COLOR = 'HEX_COLOR',
  BOOLEAN = 'BOOLEAN',
}

interface BaseCommandArgumentSpec<T = any> {
  name: string;
  description?: string;
  nullable?: boolean;
  guard?: (value: T, ctx: any) => boolean | string | Promise<boolean | string>;
}

export type CommandArgumentSpec<T = any> =
  | (BaseCommandArgumentSpec<T> & { type: CommandArgumentType.VANITY_ITEM; vanityType: 'background' | 'sticker' })
  | (BaseCommandArgumentSpec<T> & { type: Exclude<CommandArgumentType, CommandArgumentType.VANITY_ITEM> });

export function CommandArgument(specs: CommandArgumentSpec[]) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    if (!target.commandArguments) {
      target.commandArguments = {};
    }
    target.commandArguments[propertyKey] = specs;
  };
}

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

export interface QuickViewOptions {
  name: string;
}

export function QuickView(options: QuickViewOptions) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    if (!target.quickViews) {
      target.quickViews = {};
    }
    target.quickViews[options.name] = { methodName: propertyKey };
  };
}

export interface PageOptions {
  name: string;
  // if true, only the user who triggered the original reply can page through it
  restricted?: boolean;
}

// registers a static `(arg: string, page: number, authorId: string) => Promise<{content, photoUrl?, hasNext} | null>`
// method as a stateless pagination handler
export function Page(options: PageOptions) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    if (!target.pages) {
      target.pages = {};
    }
    target.pages[options.name] = { methodName: propertyKey, restricted: !!options.restricted };
  };
}
