import { test, expect, describe } from "bun:test";
import { mockTelegram } from "@girae/tests";

mockTelegram();

const { isRetriableAsVideo } = await import("../platforms/telegram");

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
