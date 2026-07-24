export type Platform = 'telegram' | 'discord' | 'none';

export interface MessageAuthor {
  id: string;
  name: string;
  avatarUrl: string;
}

export interface MessageChat {
  id: string;
  title: string;
  // Telegram forum topic id, when the message was posted inside one.
  threadId?: string;
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
  isVideo?: boolean;
  fileSizeBytes?: number;
  interactionToken?: string;
}

// Discord-only button color
export type ButtonColor = 'primary' | 'secondary' | 'success' | 'danger';

export interface InlineOption {
  title: string;
  data: any;
  color?: ButtonColor;
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
  method: 'sendMessage' | 'sendPhoto' | 'sendAnimation' | 'sendVideo' | 'editMessageMedia' | 'editMessageCaption' | 'editMessageText' | 'deleteMessage' | 'answerCallbackQuery';
  content?: string;
  photoUrl?: string;
  replyToMessageId?: string;
  messageId?: string;
  callbackQueryId?: string;
  chatId: string;
  // forum topic for a new message; irrelevant when editing/deleting an existing one.
  threadId?: string;
  platform: Platform;
  buttons?: Array<Array<{ text: string; callbackData?: string; url?: string; color?: ButtonColor }>>;
  interactionToken?: string;
  // Discord only: the author's favoriteColor, used as the embed's accent color.
  embedColor?: string;
  // Discord only: rendered as embed fields (side-by-side when inline); ignored by Telegram.
  embedFields?: { name: string; value: string; inline?: boolean }[];
}

export interface IncomingCommand {
  name: string
  args: string[]
  message: Message
  workflowIDToBeAssigned: string
}
