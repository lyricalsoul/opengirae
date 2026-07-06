import { getUserProfileByTelegramId, createUser, createUserProfile, type UserWithProfile } from "../../database/users"
import type { IncomingCommand, Message, MessageAuthor } from "./types/messaging"
import { DBOS } from '@dbos-inc/dbos-sdk'

interface CommandInfo {
  name: string;
  description: string;
  aliases?: string[];
  useWorkflow?: boolean;
}

export class Command {
  static info: CommandInfo = {
    name: 'unimplemented',
    description: 'Unimplemented command',
  }

  @DBOS.workflow()
  static async execute(ctx: IncomingCommand) {
    throw new Error('Unimplemented')
  }
}

export class CommandContext {
  public readonly commandName: string
  public readonly args: string[]
  public readonly message: Message
  public readonly workflowID: string

  public constructor(msg: IncomingCommand) {
    this.commandName = msg.name
    this.args = msg.args
    this.message = msg.message
    this.workflowID = msg.workflowIDToBeAssigned
  }

  private userWithProfile?: UserWithProfile;

  public async populateUser() {
    this.userWithProfile = await getUserProfileByTelegramId(this.message.author.id);
    if (!this.userWithProfile) {
      const user = await createUser({
        telegramId: this.message.author.id,
        displayName: this.message.author.name,
        avatarUrl: this.message.author.avatarUrl
      });
      await createUserProfile(user!.id);

      this.userWithProfile = await getUserProfileByTelegramId(this.message.author.id);
    }
  }

  public get user() {
    return this.userWithProfile!.users;
  }

  public get userProfile() {
    return this.userWithProfile!.user_profiles;
  }

  public get replyTo(): Message | undefined {
    return this.message.replyTo;
  }

  public get author(): MessageAuthor {
    return this.message.author;
  }

  public get contentWithoutCommand(): string {
    return this.args.join(' ')
  }

  public get id(): string {
    return this.message.id;
  }

  private get chatName(): string {
    return this.message.chat.title;
  }
}
