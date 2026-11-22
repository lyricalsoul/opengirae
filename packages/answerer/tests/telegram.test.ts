import { test, expect, describe, beforeEach } from "bun:test";
import { mockTelegram } from "@girae/tests";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { sentMessages } = mockTelegram();

const { isRetriableAsVideo, sendTelegramAnswer } = await import("../platforms/telegram");
const { TelegramClient } = await import("telegramsjs");

describe("isRetriableAsVideo", () => {
  test("matches Telegram's 'failed to get HTTP URL content' (seen on the first sendAnimation attempt against a just-uploaded file)", () => {
    expect(isRetriableAsVideo(new Error("Bad Request: failed to get HTTP URL content"))).toBe(true);
  });

  test("matches Telegram's 'wrong type of the web page content' (a real video with sound rejected by sendAnimation)", () => {
    expect(isRetriableAsVideo(new Error("Bad Request: wrong type of the web page content"))).toBe(true);
  });

  test("does not match an unrelated error", () => {
    expect(isRetriableAsVideo(new Error("Bad Request: chat not found"))).toBe(false);
  });

  test("does not throw on a missing/malformed error", () => {
    expect(isRetriableAsVideo(undefined)).toBe(false);
    expect(isRetriableAsVideo({})).toBe(false);
  });
});

describe("sendTelegramAnswer sendAudio branches", () => {
  beforeEach(() => { sentMessages.length = 0; });

  test("audioFileId present: sends the file_id directly, no fetch", async () => {
    const originalFetch = fetch;
    // @ts-expect-error bun-types declares fetch as a namespace, this reassignment is intentional
    fetch = (async () => { throw new Error("must not fetch when a file_id is cached"); }) as unknown as typeof fetch;
    try {
      await sendTelegramAnswer({
        method: 'sendAudio', chatId: '1', platform: 'telegram',
        audioFileId: 'CACHED_FILE_ID', audio: { entryId: 1, performer: 'Artist', title: 'Track' },
      } as any);
    } finally {
      // @ts-expect-error bun-types declares fetch as a namespace, this reassignment is intentional
      fetch = originalFetch;
    }
    const last = sentMessages[sentMessages.length - 1]!;
    expect(last.method).toBe('sendAudio');
    expect(last.audio).toBe('CACHED_FILE_ID');
  });

  test("audio.thumbnailUrl present: forwarded as thumbnail", async () => {
    await sendTelegramAnswer({
      method: 'sendAudio', chatId: '1', platform: 'telegram',
      audioFileId: 'CACHED_FILE_ID',
      audio: { entryId: 1, performer: 'Artist', title: 'Track', thumbnailUrl: 'https://cdn.example.com/cover.jpg' },
    } as any);
    const last = sentMessages[sentMessages.length - 1]!;
    expect(last.thumbnail).toBe('https://cdn.example.com/cover.jpg');
  });

  test("file://scratch ref: reads the local file and uploads it, no network fetch", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'answerer-scratch-test-'));
    const prevScratch = process.env.SCRATCH_DIR;
    process.env.SCRATCH_DIR = dir;
    try {
      await Bun.write(join(dir, 'preview.m4a'), new Uint8Array([1, 2, 3]));
      await sendTelegramAnswer({
        method: 'sendAudio', chatId: '1', platform: 'telegram',
        audioUrl: 'file://scratch/preview.m4a', audio: { entryId: 1, performer: 'Artist', title: 'Track' },
      } as any);
      const last = sentMessages[sentMessages.length - 1]!;
      expect(last.method).toBe('sendAudio');
      expect(Buffer.isBuffer(last.audio) || last.audio instanceof Uint8Array).toBe(true);
    } finally {
      process.env.SCRATCH_DIR = prevScratch;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("https url (legacy fallback): fetches bytes as before", async () => {
    const originalFetch = fetch;
    // @ts-expect-error bun-types declares fetch as a namespace, this reassignment is intentional
    fetch = (async () => new Response(new Uint8Array([9]))) as unknown as typeof fetch;
    try {
      await sendTelegramAnswer({
        method: 'sendAudio', chatId: '1', platform: 'telegram',
        audioUrl: 'https://cdn.example.com/a.m4a', audio: { entryId: 1, performer: 'Artist', title: 'Track' },
      } as any);
    } finally {
      // @ts-expect-error bun-types declares fetch as a namespace, this reassignment is intentional
      fetch = originalFetch;
    }
    const last = sentMessages[sentMessages.length - 1]!;
    expect(last.method).toBe('sendAudio');
  });

  test("file://scratch ref, file missing entirely: falls back to sendMessage instead of throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'answerer-scratch-missing-'));
    const prevScratch = process.env.SCRATCH_DIR;
    process.env.SCRATCH_DIR = dir;
    try {
      await sendTelegramAnswer({
        method: 'sendAudio', chatId: '1', platform: 'telegram', content: 'fallback text',
        audioUrl: 'file://scratch/missing.m4a', audio: { entryId: 1, performer: 'Artist', title: 'Track' },
      } as any);
    } finally {
      process.env.SCRATCH_DIR = prevScratch;
      await rm(dir, { recursive: true, force: true });
    }
    const last = sentMessages[sentMessages.length - 1]!;
    expect(last.method).toBe('sendMessage');
  });

  test("file://scratch ref, file present but empty: falls back to sendMessage instead of sending a 0-byte audio", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'answerer-scratch-empty-'));
    const prevScratch = process.env.SCRATCH_DIR;
    process.env.SCRATCH_DIR = dir;
    try {
      await Bun.write(join(dir, 'empty.m4a'), new Uint8Array(0));
      await sendTelegramAnswer({
        method: 'sendAudio', chatId: '1', platform: 'telegram', content: 'fallback text',
        audioUrl: 'file://scratch/empty.m4a', audio: { entryId: 1, performer: 'Artist', title: 'Track' },
      } as any);
    } finally {
      process.env.SCRATCH_DIR = prevScratch;
      await rm(dir, { recursive: true, force: true });
    }
    const last = sentMessages[sentMessages.length - 1]!;
    expect(last.method).toBe('sendMessage');
  });
});

describe("sendTelegramAnswer editMessageText fallback", () => {
  beforeEach(() => { sentMessages.length = 0; });

  test("target message has no text (only media/caption): retries as editMessageCaption", async () => {
    const original = TelegramClient.prototype.editMessageText;
    let attempts = 0;
    TelegramClient.prototype.editMessageText = async function () {
      attempts++;
      throw new Error("Bad Request: there is no text in the message to edit");
    };
    try {
      await sendTelegramAnswer({
        method: 'editMessageText', chatId: '1', messageId: '42', platform: 'telegram', content: 'new caption text',
      } as any);
    } finally {
      TelegramClient.prototype.editMessageText = original;
    }
    expect(attempts).toBe(1);
    const last = sentMessages[sentMessages.length - 1]!;
    expect(last.method).toBe('editMessageCaption');
    expect(last.caption).toBe('new caption text');
  });

  test("an unrelated editMessageText error is not swallowed into the fallback", async () => {
    const original = TelegramClient.prototype.editMessageText;
    TelegramClient.prototype.editMessageText = async function () {
      throw new Error("Bad Request: chat not found");
    };
    try {
      await expect(sendTelegramAnswer({
        method: 'editMessageText', chatId: '1', messageId: '42', platform: 'telegram', content: 'new text',
      } as any)).rejects.toThrow("chat not found");
    } finally {
      TelegramClient.prototype.editMessageText = original;
    }
  });
});

describe("sendTelegramAnswer sendPhoto caption cap", () => {
  beforeEach(() => { sentMessages.length = 0; });

  test("a caption over 1024 chars goes out as a bare photo plus a text message instead of a doomed sendPhoto", async () => {
    const content = 'x'.repeat(1500);
    await sendTelegramAnswer({ method: 'sendPhoto', chatId: '1', platform: 'telegram', content, photoUrl: 'https://example.com/a.jpg' } as any);

    expect(sentMessages.map(m => m.method)).toEqual(['sendPhoto', 'sendMessage']);
    expect(sentMessages[0]!.caption).toBeUndefined();
    expect(sentMessages[1]!.text).toContain('x'.repeat(1500));
  });

  test("a short caption still rides on the photo", async () => {
    await sendTelegramAnswer({ method: 'sendPhoto', chatId: '1', platform: 'telegram', content: 'oi', photoUrl: 'https://example.com/a.jpg' } as any);
    expect(sentMessages.map(m => m.method)).toEqual(['sendPhoto']);
    expect(sentMessages[0]!.caption).toBe('oi');
  });
});
