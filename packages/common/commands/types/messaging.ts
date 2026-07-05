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

export interface PendingResponse {
  method: 'sendMessage' | 'sendPhoto'
  content: string;
  photoUrl?: string;
  replyToMessageId?: string;
  chatId: string;
  platform: Platform
}

export interface IncomingCommand {
  name: string
  args: string[]
  message: Message
}
