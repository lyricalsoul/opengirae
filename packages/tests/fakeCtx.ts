// Shared IncomingCommand builder for command E2E tests - replaces the near-identical
// local `ctx()`/`fakeCtx()` function every commandeer test file used to hand-roll.
import type { IncomingCommand, Message, Platform } from "@girae/common/commands/types";

export interface FakeCtxOptions {
  name: string;
  args?: string[];
  authorId: string;
  authorName?: string;
  platform?: Platform;
  chatId?: string;
  replyToAuthorId?: string;
  replyToId?: string;
  /** Override the auto-generated workflow id - needed when a test drives a @Page handler by run id. */
  workflowID?: string;
}

/**
 * Builds a synthetic IncomingCommand for calling a Command's `execute()`/`@Subcommand`
 * method directly in a test - bypasses the real inbound/queue layer entirely, same
 * shape every hand-rolled version already used. `platform: 'none'` is a genuine
 * no-op platform (see `answerer/handler.ts`), safe for tests that go through the
 * real reply queue.
 */
export function fakeCtx(opts: FakeCtxOptions): IncomingCommand {
  const args = opts.args ?? [];
  const platform = opts.platform ?? 'none';

  const replyTo: Message | undefined = opts.replyToAuthorId ? {
    id: opts.replyToId ?? 'reply-msg-1',
    author: { id: opts.replyToAuthorId, name: 'Tester', avatarUrl: '' },
    chat: { id: opts.chatId ?? 'chat-1', title: 'test' },
    content: '',
    timestamp: new Date(),
    platform,
  } : undefined;

  return {
    name: opts.name,
    args,
    workflowIDToBeAssigned: opts.workflowID ?? `test-${opts.name}-${Date.now()}-${Math.random()}`,
    message: {
      id: 'msg-1',
      author: { id: opts.authorId, name: opts.authorName ?? 'Tester', avatarUrl: '' },
      chat: { id: opts.chatId ?? 'chat-1', title: 'test' },
      content: `/${opts.name} ${args.join(' ')}`.trim(),
      timestamp: new Date(),
      platform,
      replyTo,
    },
  };
}
