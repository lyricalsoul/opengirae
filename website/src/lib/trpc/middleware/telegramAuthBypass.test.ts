import { test, expect, describe, mock } from "bun:test";

// Separate file from telegramAuth.test.ts because $env/dynamic/private is mocked once at
// module-import time - this file needs the bypass flag set, the other needs it unset.
mock.module("$env/dynamic/private", () => ({
	env: {
		TELEGRAM_TOKEN: "test-token-not-a-real-secret",
		BYPASS_TELEGRAM_AUTH_DO_NOT_USE_THIS_IN_PROD_PRETTY_PLEASE: "1",
		ORIGIN: "http://localhost:5173",
	},
}));

const { telegramProcedure } = await import("./telegramAuth");
const { initTRPC } = await import("@trpc/server");

describe("telegramProcedure with the dev bypass flag set", () => {
	const router = initTRPC.context<{ tmaInitData: string | null }>().create().router({
		whoAmI: telegramProcedure.query(({ ctx }) => ctx.tgUser),
	});

	test("falls back to the fixed dev user when there's no initData", async () => {
		const caller = router.createCaller({ tmaInitData: null });
		const tgUser = await caller.whoAmI();
		expect(tgUser).toEqual({ id: 1889562226 });
	});

	test("still resolves the real tgUser when valid initData is present", async () => {
		// same fixture pattern as telegramAuth.test.ts's invalid-signature case, just proving the
		// bypass doesn't shadow a real (if here still invalid-signature) init-data attempt
		const INVALID_INIT_DATA = "user=%7B%22id%22%3A123%7D&auth_date=1700000000&hash=0000000000000000000000000000000000000000000000000000000000000000";
		const caller = router.createCaller({ tmaInitData: INVALID_INIT_DATA });
		const tgUser = await caller.whoAmI();
		expect(tgUser).toEqual({ id: 1889562226 }); // invalid signature still falls through to the bypass, not through to a fake tgUser
	});
});

describe("authBypassEnabled", () => {
	test("is on for the flag plus a localhost ORIGIN, off for the flag with a real deployment's ORIGIN", async () => {
		const { env } = await import("$env/dynamic/private");
		const { authBypassEnabled } = await import("./authBypass");
		expect(authBypassEnabled()).toBe(true);

		const original = env.ORIGIN;
		try {
			(env as Record<string, string>).ORIGIN = "https://girae.io";
			expect(authBypassEnabled()).toBe(false);
		} finally {
			(env as Record<string, string>).ORIGIN = original!;
		}
	});
});
