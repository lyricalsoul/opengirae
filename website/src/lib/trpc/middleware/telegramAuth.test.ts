import { test, expect, describe, mock } from "bun:test";

// $env/dynamic/private is a SvelteKit virtual module - only resolvable through SvelteKit's own
// Vite plugin, not under plain `bun test`. Stub it before importing telegramAuth.ts so the real
// middleware code (which uses it, matching this codebase's server-secret convention) can still
// be exercised directly here.
mock.module("$env/dynamic/private", () => ({ env: { TELEGRAM_TOKEN: "test-token-not-a-real-secret" } }));

const { telegramProcedure } = await import("./telegramAuth");
const { initTRPC } = await import("@trpc/server");

// A fake initData string with a deliberately wrong signature - validate() must reject it
// regardless of TELEGRAM_TOKEN's actual value in this test environment.
const INVALID_INIT_DATA = "user=%7B%22id%22%3A123%7D&auth_date=1700000000&hash=0000000000000000000000000000000000000000000000000000000000000000";

describe("telegramProcedure", () => {
	const router = initTRPC.context<{ tmaInitData: string | null }>().create().router({
		whoAmI: telegramProcedure.query(({ ctx }) => ctx.tgUser),
	});

	test("rejects when there's no initData header at all", async () => {
		const caller = router.createCaller({ tmaInitData: null });
		await expect(caller.whoAmI()).rejects.toThrow();
	});

	test("rejects an invalid/tampered initData signature", async () => {
		const caller = router.createCaller({ tmaInitData: INVALID_INIT_DATA });
		await expect(caller.whoAmI()).rejects.toThrow();
	});
});
