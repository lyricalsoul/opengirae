import { Worker } from "bullmq";
import { RESPONSE_QUEUE_NAME } from "@girae/common/constants";
import { connection } from "@girae/common/consensus";
import { info } from "@girae/common/logger";
import { createRestManager } from "@discordeno/rest";
import type { PendingResponse } from "@girae/common/commands/types";
import { error } from "@girae/common/logger"

const manager = createRestManager({
  token: process.env.DISCORD_TOKEN!,
});

const worker = new Worker<PendingResponse>(RESPONSE_QUEUE_NAME, async (job) => {
  // Process response job
  console.log(job.name, job.data);

  if (job.data.platform === 'none') return

  if (job.data.platform === 'discord') {
    switch (job.data.method) {
      case 'sendMessage':
        await manager.sendMessage(job.data.chatId, {
          content: job.data.content,
          messageReference: {
            messageId: job.data.replyToMessageId,
            failIfNotExists: false
          }
        })
        break
      default:
        error('answerer', `Unimplemented method: ${job.data.method}`)
    }
  }

// @ts-ignore
}, { connection });

worker.on('ready', () => {
  info('answerer', 'Worker is ready');
});
