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
  platform: Platform
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
}

export interface StoredStep {
  options: Array<{ id: string; data: any }>;
  authorIds: string[];
  restricted: 'author' | 'none';
}

export interface PendingResponse {
  method: 'sendMessage' | 'sendPhoto' | 'editMessageText' | 'editMessageCaption' | 'deleteMessage';
  content?: string;
  photoUrl?: string;
  replyToMessageId?: string;
  messageId?: string;
  chatId: string;
  platform: Platform;
  buttons?: Array<{ text: string; callbackData?: string; url?: string }>;
}

export interface IncomingCommand {
  name: string
  args: string[]
  message: Message
  workflowIDToBeAssigned: string
}
