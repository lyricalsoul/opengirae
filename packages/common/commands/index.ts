import { getUserProfileByTelegramId, createUser, createUserProfile, type UserWithProfile } from "../../database/users"
import { responseQueue } from "../consensus/queues";
import type { Message, MessageAuthor } from "./types/messaging"

export class CommandContext {
  public constructor(
    public readonly commandName: string,
    public readonly args: string[],
    public readonly message: Message,
  ) { }

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

  public async reply(content: string) {
    const method = 'sendMessage'

    await responseQueue.add(this.makeJobName(method), {
      method,
      chatId: this.message.chat.id,
      content,
      replyToMessageId: this.message.id,
      platform: this.message.platform,
    });
  }

  private get chatName(): string {
    return this.message.chat.title;
  }

  private makeJobName(method: string): string {
    return `${this.message.platform}: ${this.commandName} (${this.author.name} @ ${this.chatName}, ${method})`;
  }
}
