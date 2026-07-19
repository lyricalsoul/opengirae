export type Platform = 'telegram' | 'discord' | 'none';

export interface MessageAuthor {
  id: string;
  name: string;
  avatarUrl: string;
}

export interface MessageChat {
  id: string;
  title: string;
}

export interface Message {
  id: string;
  author: MessageAuthor;
  chat: MessageChat;
  content: string;
  replyTo?: Message;
  timestamp: Date;
  platform: Platform;
  photoUrl?: string;
  isAnimatedPhoto?: boolean;
  // Discord only: the slash-command interaction's token, needed to edit the deferred
  // response via the interaction-response API rather than a plain channel message edit -
  // a plain edit changes the content but never clears Discord's "thinking..." indicator.
  interactionToken?: string;
}

export interface InlineOption {
  title: string;
  data: any;
}

export interface InlineReplyOptions {
  content: string;
  eventName: string;
  options: InlineOption[];
  restricted: 'author' | 'none';
  authorIds?: string[];
  editMessageId?: string;
  photoUrl?: string;
  rows?: number[];
  multiUse?: boolean;
}

export interface StoredStep {
  options: Array<{ id: string; data: any }>;
  authorIds: string[];
  restricted: 'author' | 'none';
  multiUse: boolean;
}

export interface PendingResponse {
  method: 'sendMessage' | 'sendPhoto' | 'sendAnimation' | 'editMessageMedia' | 'editMessageCaption' | 'editMessageText' | 'deleteMessage' | 'answerCallbackQuery';
  content?: string;
  photoUrl?: string;
  replyToMessageId?: string;
  messageId?: string;
  callbackQueryId?: string;
  chatId: string;
  platform: Platform;
  buttons?: Array<Array<{ text: string; callbackData?: string; url?: string }>>;
  interactionToken?: string;
  // Discord only: the author's favoriteColor, used as the embed's accent color.
  embedColor?: string;
}

export interface IncomingCommand {
  name: string
  args: string[]
  message: Message
  workflowIDToBeAssigned: string
}
