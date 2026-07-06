import { DBOS } from '@girae/common/dbos'
import { createRestManager } from "@discordeno/rest";
import { error } from "@girae/common/logger";
import type { PendingResponse } from "@girae/common/commands/types";
import { TelegramClient } from 'telegramsjs'

const tg = new TelegramClient(process.env.TELEGRAM_TOKEN!)

const manager = createRestManager({
  token: process.env.DISCORD_TOKEN!,
});

class BotResponseService {
  @DBOS.workflow()
  static async sendAnswer(response: PendingResponse) {
    if (response.platform === 'none') return;

    if (response.platform === 'discord') {
      await BotResponseService.sendDiscordAnswer(response);
    } else if (response.platform === 'telegram') {
      await BotResponseService.sendTelegramAnswer(response);
    }
  }

  @DBOS.step()
  static async sendDiscordAnswer(response: PendingResponse) {
    switch (response.method) {
      case 'sendMessage':
        await manager.sendMessage(response.chatId, {
          content: response.content,
          messageReference: {
            messageId: response.replyToMessageId,
            failIfNotExists: false
          }
        });
        break;
      default:
        error('answerer', `Unimplemented method: ${response.method}`);
        // Throwing an error here triggers DBOS's built-in retry mechanisms
        throw new Error(`Unimplemented method: ${response.method}`); 
    }
  }

  @DBOS.step()
  static async sendTelegramAnswer(response: PendingResponse) {
    switch (response.method) {
      case 'sendMessage':
        await tg.sendMessage({
          chatId: response.chatId,
          text: response.content,
          disableNotification: true,
          replyParameters: response.replyToMessageId ? {
            message_id: response.replyToMessageId,
            allow_sending_without_reply: false
          } : undefined
        })
        break;
      default:
        error('answerer', `Unimplemented method: ${response.method}`);
        // Throwing an error here triggers DBOS's built-in retry mechanisms
        throw new Error(`Unimplemented method: ${response.method}`); 
    }
  }
}
