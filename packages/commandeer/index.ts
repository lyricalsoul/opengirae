import type { IncomingCommand } from '@girae/common/commands/types';
import { COMMAND_QUEUE_NAME } from '@girae/common/constants';
import { Worker } from 'bullmq';
import { connection } from '@girae/common/consensus';
import { error, info } from '@girae/common/logger';
import { findCommand } from './loader';
import { CommandContext } from '@girae/common/commands';

const worker = new Worker<IncomingCommand>(COMMAND_QUEUE_NAME, async (job, token) => {
  const command = findCommand(job.data.name);
  if (!command) {
    error('commandeer', `Got a command I can't handle: ${job.data.name}`);
    await job.moveToWait(token);
    return;
  }

  const context = new CommandContext(
    job.data.name,
    job.data.args,
    job.data.message
  );

  await context.populateUser();

  try {
    await command.module.execute(context);
  } catch (err: any) {
    error('commandeer', `Error executing command ${job.data.name}:`+ err.stack);
  }
// @ts-ignore
}, { connection });

worker.on('ready', () => {
  info('commandeer', 'Worker is ready');
});
