import { test, expect, describe } from "bun:test";
import { isEmojiOnly, containsRarityEmoji, validateCustomEmoji } from "../../services/cards/cativeiro";

describe("isEmojiOnly", () => {
  test.each(['🎉', '😅', '🥺', '👨‍👩‍👧'])("%s is accepted", (emoji) => {
    expect(isEmojiOnly(emoji)).toBe(true);
  });

  test.each(['hello', 'hi🎉', '123', ''])("%s is rejected", (text) => {
    expect(isEmojiOnly(text)).toBe(false);
  });

  test("surrounding whitespace is trimmed before checking", () => {
    expect(isEmojiOnly('  🎉  ')).toBe(true);
  });
});

describe("containsRarityEmoji", () => {
  test.each(['🥉', '🥈', '🥇'])("flags the bot's own rarity marker %s", (emoji) => {
    expect(containsRarityEmoji(emoji)).toBe(true);
  });

  test("flags a rarity marker mixed in with other emoji", () => {
    expect(containsRarityEmoji('✨🥇')).toBe(true);
  });

  test("a regular emoji is not a rarity marker", () => {
    expect(containsRarityEmoji('💎')).toBe(false);
  });
});

describe("validateCustomEmoji", () => {
  test("accepts a normal emoji", () => {
    expect(validateCustomEmoji('💎')).toBe(true);
  });

  test("rejects plain text with a friendly message", () => {
    expect(validateCustomEmoji('hello')).toContain('emoji de verdade');
  });

  test.each(['🥉', '🥈', '🥇'])("rejects the bot's own rarity marker %s with a friendly message", (emoji) => {
    expect(validateCustomEmoji(emoji)).toContain('raridade das cartas');
  });
});
