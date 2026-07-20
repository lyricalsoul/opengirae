import { test, expect, describe } from "bun:test";
import { CommandArgumentType, type CommandArgumentSpec } from "@girae/common/commands";
import type { IncomingCommand } from "@girae/common/commands/types";
import { splitPositionalTokens, parseCommandArguments, resolveCommandArguments } from "../../services/commandArguments";

function fakeCtx(args: string[], opts: { replyToAuthorId?: string } = {}): IncomingCommand {
  return {
    name: 'test',
    args,
    workflowIDToBeAssigned: `test-${Date.now()}-${Math.random()}`,
    message: {
      id: 'msg-1',
      author: { id: 'author-1', name: 'Tester', avatarUrl: '' },
      chat: { id: 'chat-1', title: 'test' },
      content: `/test ${args.join(' ')}`,
      timestamp: new Date(),
      // 'none' is a genuine no-op in packages/answerer/handler.ts - safe to let the
      // real reply()/resolveCommandArguments path run end to end in these tests
      // without touching Telegram or requiring any mocking.
      platform: 'none',
      replyTo: opts.replyToAuthorId ? {
        id: 'reply-msg-1',
        author: { id: opts.replyToAuthorId, name: 'Replied', avatarUrl: '' },
        chat: { id: 'chat-1', title: 'test' },
        content: '',
        timestamp: new Date(),
        platform: 'none',
      } : undefined,
    },
  };
}

describe("splitPositionalTokens", () => {
  test("single greedy STRING spec joins every token", () => {
    const specs: CommandArgumentSpec[] = [{ name: 'text', type: CommandArgumentType.STRING }];
    expect(splitPositionalTokens(['hello', 'world'], specs)).toEqual(['hello world']);
  });

  test("addsubcategory shape: NUMBER then trailing greedy STRING", () => {
    const specs: CommandArgumentSpec[] = [
      { name: 'category', type: CommandArgumentType.NUMBER },
      { name: 'name', type: CommandArgumentType.STRING },
    ];
    expect(splitPositionalTokens(['5', 'Naruto', 'Shippuden'], specs)).toEqual(['5', 'Naruto Shippuden']);
  });

  test("two single-token NUMBER specs each eat exactly one token, extras ignored", () => {
    const specs: CommandArgumentSpec[] = [
      { name: 'a', type: CommandArgumentType.NUMBER },
      { name: 'b', type: CommandArgumentType.NUMBER },
    ];
    expect(splitPositionalTokens(['1', '2', '3', '4'], specs)).toEqual(['1', '2']);
  });

  test("more specs than args leaves trailing ones undefined", () => {
    const specs: CommandArgumentSpec[] = [
      { name: 'a', type: CommandArgumentType.NUMBER },
      { name: 'b', type: CommandArgumentType.STRING },
    ];
    expect(splitPositionalTokens(['1'], specs)).toEqual(['1', undefined]);
  });

  test("no args at all: every spec resolves to undefined", () => {
    const specs: CommandArgumentSpec[] = [{ name: 'a', type: CommandArgumentType.STRING }];
    expect(splitPositionalTokens([], specs)).toEqual([undefined]);
  });

  test("only the LAST spec is greedy - a CARD/STRING type mid-array still eats one token", () => {
    const specs: CommandArgumentSpec[] = [
      { name: 'first', type: CommandArgumentType.STRING },
      { name: 'second', type: CommandArgumentType.NUMBER },
    ];
    expect(splitPositionalTokens(['one', 'two', '3'], specs)).toEqual(['one', 'two']);
  });

  test("empty-string tokens (handler.ts's naive double-space split) count as missing", () => {
    const specs: CommandArgumentSpec[] = [
      { name: 'a', type: CommandArgumentType.NUMBER },
      { name: 'b', type: CommandArgumentType.NUMBER },
    ];
    expect(splitPositionalTokens(['', '5'], specs)).toEqual([undefined, '5']);
  });

  test("strade shape: a leading USER_MENTION resolved via replyTo doesn't eat a token - later specs still see args[0], args[1]", () => {
    const specs: CommandArgumentSpec[] = [
      { name: 'target', type: CommandArgumentType.USER_MENTION },
      { name: 'a', type: CommandArgumentType.NUMBER },
      { name: 'b', type: CommandArgumentType.NUMBER },
    ];
    const ctx = fakeCtx(['5', '7'], { replyToAuthorId: 'replied-author' });
    expect(splitPositionalTokens(ctx.args, specs, ctx)).toEqual([undefined, '5', '7']);
  });

  test("same shape with no replyTo: USER_MENTION falls back to eating args[0] like any other spec", () => {
    const specs: CommandArgumentSpec[] = [
      { name: 'target', type: CommandArgumentType.USER_MENTION },
      { name: 'a', type: CommandArgumentType.NUMBER },
      { name: 'b', type: CommandArgumentType.NUMBER },
    ];
    const ctx = fakeCtx(['123456789', '5', '7']);
    expect(splitPositionalTokens(ctx.args, specs, ctx)).toEqual(['123456789', '5', '7']);
  });
});

describe("parseCommandArguments - NUMBER/STRING (no DB, no I/O)", () => {
  test("all required args present", async () => {
    const specs: CommandArgumentSpec[] = [
      { name: 'id', type: CommandArgumentType.NUMBER },
      { name: 'text', type: CommandArgumentType.STRING },
    ];
    const result = await parseCommandArguments(specs, ['5', 'hello', 'world'], fakeCtx([]));
    expect(result).toEqual({ ok: true, values: { id: 5, text: 'hello world' } });
  });

  test("missing required arg fails with no message (generic usage fallback expected upstream)", async () => {
    const specs: CommandArgumentSpec[] = [{ name: 'id', type: CommandArgumentType.NUMBER }];
    const result = await parseCommandArguments(specs, [], fakeCtx([]));
    expect(result.ok).toBe(false);
  });

  test("nullable missing arg resolves to undefined instead of failing", async () => {
    const specs: CommandArgumentSpec[] = [{ name: 'id', type: CommandArgumentType.NUMBER, nullable: true }];
    const result = await parseCommandArguments(specs, [], fakeCtx([]));
    expect(result).toEqual({ ok: true, values: { id: undefined } });
  });

  test("invalid NUMBER fails", async () => {
    const specs: CommandArgumentSpec[] = [{ name: 'id', type: CommandArgumentType.NUMBER }];
    const result = await parseCommandArguments(specs, ['not-a-number'], fakeCtx([]));
    expect(result.ok).toBe(false);
  });

  // Documents existing loose parseInt semantics (every hand-rolled command already
  // relied on isNaN(parseInt(x, 10)), not a stricter integer regex) - not a bug,
  // just worth pinning down so a future "let's tighten NUMBER" change is deliberate.
  test("NUMBER uses parseInt's loose semantics - leading digits win, trailing junk is dropped", async () => {
    const specs: CommandArgumentSpec[] = [{ name: 'id', type: CommandArgumentType.NUMBER }];
    const result = await parseCommandArguments(specs, ['12abc'], fakeCtx([]));
    expect(result).toEqual({ ok: true, values: { id: 12 } });
  });

  test("guard failing rejects an otherwise-valid value", async () => {
    const specs: CommandArgumentSpec[] = [{
      name: 'hex', type: CommandArgumentType.STRING,
      guard: (v: string) => /^#[0-9a-f]{6}$/i.test(v),
    }];
    const result = await parseCommandArguments(specs, ['not-hex'], fakeCtx([]));
    expect(result.ok).toBe(false);
  });

  test("guard passing lets the value through", async () => {
    const specs: CommandArgumentSpec[] = [{
      name: 'hex', type: CommandArgumentType.STRING,
      guard: (v: string) => /^#[0-9a-f]{6}$/i.test(v),
    }];
    const result = await parseCommandArguments(specs, ['#ff0000'], fakeCtx([]));
    expect(result).toEqual({ ok: true, values: { hex: '#ff0000' } });
  });

  test("guard is skipped for a nullable arg that wasn't provided", async () => {
    const specs: CommandArgumentSpec[] = [{
      name: 'hex', type: CommandArgumentType.STRING, nullable: true,
      guard: () => { throw new Error('guard must not run when the value is absent') },
    }];
    const result = await parseCommandArguments(specs, [], fakeCtx([]));
    expect(result).toEqual({ ok: true, values: { hex: undefined } });
  });
});

describe("parseCommandArguments - USER_MENTION", () => {
  test("replyTo always wins over a typed argument", async () => {
    const specs: CommandArgumentSpec[] = [{ name: 'user', type: CommandArgumentType.USER_MENTION }];
    const ctx = fakeCtx(['999999999'], { replyToAuthorId: 'replied-author' });
    const result = await parseCommandArguments(specs, ctx.args, ctx);
    expect(result).toEqual({ ok: true, values: { user: 'replied-author' } });
  });

  test("a short numeric argument is looked up as a girae id, not a platform id", async () => {
    const specs: CommandArgumentSpec[] = [{ name: 'user', type: CommandArgumentType.USER_MENTION }];
    const ctx = fakeCtx(['123456789']);
    const result = await parseCommandArguments(specs, ctx.args, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Não encontrei o usuário com ID 123456789');
  });

  test("a 16+ digit argument passes through with no DB lookup - Discord snowflakes are UI-resolved, never typed", async () => {
    const specs: CommandArgumentSpec[] = [{ name: 'user', type: CommandArgumentType.USER_MENTION }];
    const ctx = fakeCtx(['1234567890123456']);
    const result = await parseCommandArguments(specs, ctx.args, ctx);
    expect(result).toEqual({ ok: true, values: { user: '1234567890123456' } });
  });

  test("no replyTo and no argument at all fails (nullable governs whether that's fatal)", async () => {
    const requiredSpecs: CommandArgumentSpec[] = [{ name: 'user', type: CommandArgumentType.USER_MENTION }];
    const requiredResult = await parseCommandArguments(requiredSpecs, [], fakeCtx([]));
    expect(requiredResult.ok).toBe(false);

    const nullableSpecs: CommandArgumentSpec[] = [{ name: 'user', type: CommandArgumentType.USER_MENTION, nullable: true }];
    const nullableResult = await parseCommandArguments(nullableSpecs, [], fakeCtx([]));
    expect(nullableResult).toEqual({ ok: true, values: { user: undefined } });
  });

  test("@username with no matching user gets a specific not-found message, not the generic usage fallback", async () => {
    const specs: CommandArgumentSpec[] = [{ name: 'user', type: CommandArgumentType.USER_MENTION }];
    const ctx = fakeCtx(['@this-username-definitely-does-not-exist-12345']);
    const result = await parseCommandArguments(specs, ctx.args, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Não encontrei o usuário');
  });

  test("garbage that's neither @username nor a numeric id fails generically", async () => {
    const specs: CommandArgumentSpec[] = [{ name: 'user', type: CommandArgumentType.USER_MENTION }];
    const ctx = fakeCtx(['not-a-mention-or-id']);
    const result = await parseCommandArguments(specs, ctx.args, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeUndefined();
  });

  test("strade shape: replyTo resolves target AND leaves both trailing NUMBER specs intact", async () => {
    const specs: CommandArgumentSpec[] = [
      { name: 'target', type: CommandArgumentType.USER_MENTION },
      { name: 'a', type: CommandArgumentType.NUMBER },
      { name: 'b', type: CommandArgumentType.NUMBER },
    ];
    const ctx = fakeCtx(['5', '7'], { replyToAuthorId: 'replied-author' });
    const result = await parseCommandArguments(specs, ctx.args, ctx);
    expect(result).toEqual({ ok: true, values: { target: 'replied-author', a: 5, b: 7 } });
  });
});

// These hit the real CardsDB - only asserting the "definitely does not exist" path,
// which needs no fixture data beyond an ID nobody will ever use.
describe("parseCommandArguments - CARD/CATEGORY/SUBCATEGORY not-found paths", () => {
  const IMPOSSIBLE_ID = 999999999;

  test("CARD by a nonexistent numeric ID gets a specific not-found message", async () => {
    const specs: CommandArgumentSpec[] = [{ name: 'card', type: CommandArgumentType.CARD }];
    const result = await parseCommandArguments(specs, [String(IMPOSSIBLE_ID)], fakeCtx([]));
    expect(result).toEqual({ ok: false, message: 'Não encontrei um personagem com esse ID.' });
  });

  test("CATEGORY by a nonexistent numeric ID gets a not-found message listing valid categories", async () => {
    const specs: CommandArgumentSpec[] = [{ name: 'category', type: CommandArgumentType.CATEGORY }];
    const result = await parseCommandArguments(specs, [String(IMPOSSIBLE_ID)], fakeCtx([]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Categoria não encontrada.');
  });

  test("SUBCATEGORY by a nonexistent numeric ID gets a specific not-found message", async () => {
    const specs: CommandArgumentSpec[] = [{ name: 'subcategory', type: CommandArgumentType.SUBCATEGORY }];
    const result = await parseCommandArguments(specs, [String(IMPOSSIBLE_ID)], fakeCtx([]));
    expect(result).toEqual({ ok: false, message: 'Não encontrei uma subcategoria com esse ID.' });
  });

  test("CARD by a name nobody has ever used gets the by-name not-found message", async () => {
    const specs: CommandArgumentSpec[] = [{ name: 'card', type: CommandArgumentType.CARD }];
    const result = await parseCommandArguments(specs, ['zzzznonexistentcardnamezzzz'], fakeCtx([]));
    expect(result).toEqual({ ok: false, message: 'Não encontrei um personagem com esse nome.' });
  });
});

// Only the success path is covered here - it returns without calling reply() at all.
// The failure path calls the real reply(), which awaits job.waitUntilFinished() and
// only resolves once a live `answerer` worker consumes the queued job - that's a
// live-worker dependency beyond what a unit test should require, so it's out of
// scope here. parseCommandArguments's tests above already cover every failure case
// resolveCommandArguments branches on (it just replies and returns null when !ok).
describe("parseCommandArguments - HEX_COLOR", () => {
  test("accepts a 6-digit hex with a leading #", async () => {
    const specs: CommandArgumentSpec[] = [{ name: 'color', type: CommandArgumentType.HEX_COLOR }];
    const result = await parseCommandArguments(specs, ['#ff0000'], fakeCtx([]));
    expect(result).toEqual({ ok: true, values: { color: '#ff0000' } });
  });

  test("normalizes a hex without a leading # by adding one", async () => {
    const specs: CommandArgumentSpec[] = [{ name: 'color', type: CommandArgumentType.HEX_COLOR }];
    const result = await parseCommandArguments(specs, ['ff0000'], fakeCtx([]));
    expect(result).toEqual({ ok: true, values: { color: '#ff0000' } });
  });

  test("rejects an invalid hex with a specific message, not the generic usage fallback", async () => {
    const specs: CommandArgumentSpec[] = [{ name: 'color', type: CommandArgumentType.HEX_COLOR }];
    const result = await parseCommandArguments(specs, ['not-a-color'], fakeCtx([]));
    expect(result).toEqual({ ok: false, message: 'Não consegui encontrar um código HEX válido. 😔' });
  });
});

describe("parseCommandArguments - BOOLEAN", () => {
  const specs: CommandArgumentSpec[] = [{ name: 'flag', type: CommandArgumentType.BOOLEAN }];

  test.each(['yes', 'sim', '1', 'on', 'ativar', 'SIM', 'ON'])("%s resolves to true", async (token) => {
    const result = await parseCommandArguments(specs, [token], fakeCtx([]));
    expect(result).toEqual({ ok: true, values: { flag: true } });
  });

  test.each(['no', 'nao', 'não', '0', 'off', 'desativar', 'NÃO', 'OFF'])("%s resolves to false", async (token) => {
    const result = await parseCommandArguments(specs, [token], fakeCtx([]));
    expect(result).toEqual({ ok: true, values: { flag: false } });
  });

  test("an unrecognized token fails rather than silently defaulting", async () => {
    const result = await parseCommandArguments(specs, ['banana'], fakeCtx([]));
    expect(result.ok).toBe(false);
  });
});

describe("parseCommandArguments - guard returning a custom message", () => {
  test("a string guard result replaces the generic usage fallback", async () => {
    const specs: CommandArgumentSpec[] = [{
      name: 'bio', type: CommandArgumentType.STRING,
      guard: (v: string) => v.length <= 10 || 'Texto muito longo! 😅',
    }];
    const result = await parseCommandArguments(specs, ['this is way too long'], fakeCtx([]));
    expect(result).toEqual({ ok: false, message: 'Texto muito longo! 😅' });
  });

  test("a boolean-false guard result still falls back to the generic usage path (no message)", async () => {
    const specs: CommandArgumentSpec[] = [{
      name: 'bio', type: CommandArgumentType.STRING,
      guard: (v: string) => v.length <= 10,
    }];
    const result = await parseCommandArguments(specs, ['this is way too long'], fakeCtx([]));
    expect(result).toEqual({ ok: false });
  });
});

// Hits the real VanitiesDB - only the "definitely doesn't exist" path, no fixtures needed.
describe("parseCommandArguments - VANITY_ITEM not-found path", () => {
  test("a nonexistent numeric ID gets a specific not-found message", async () => {
    const specs: CommandArgumentSpec[] = [{ name: 'item', type: CommandArgumentType.VANITY_ITEM, vanityType: 'background' }];
    const result = await parseCommandArguments(specs, ['999999999'], fakeCtx([]));
    expect(result).toEqual({ ok: false, message: 'Não encontrei um papel de parede com esse ID.' });
  });

  test("a name nobody has ever used gets the by-name not-found message", async () => {
    const specs: CommandArgumentSpec[] = [{ name: 'item', type: CommandArgumentType.VANITY_ITEM, vanityType: 'sticker' }];
    const result = await parseCommandArguments(specs, ['zzzznonexistentitemnamezzzz'], fakeCtx([]));
    expect(result).toEqual({ ok: false, message: 'Não encontrei um sticker com esse nome.' });
  });
});

describe("parseCommandArguments - CATEGORY fuzzy search (fixed gap: previously exact-name-only)", () => {
  test("a nonexistent name gets the not-found message listing valid categories", async () => {
    const specs: CommandArgumentSpec[] = [{ name: 'category', type: CommandArgumentType.CATEGORY }];
    const result = await parseCommandArguments(specs, ['zzzznonexistentcategoryzzzz'], fakeCtx([]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Categoria não encontrada.');
  });
});

describe("resolveCommandArguments (shell)", () => {
  test("success returns the resolved values without sending any reply", async () => {
    const specs: CommandArgumentSpec[] = [{ name: 'id', type: CommandArgumentType.NUMBER }];
    const result = await resolveCommandArguments(specs, fakeCtx(['42']), '/test <id>');
    expect(result).toEqual({ id: 42 });
  });
});
