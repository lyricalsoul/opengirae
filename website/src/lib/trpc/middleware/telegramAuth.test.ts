import { test, expect, describe } from "bun:test";
import { initTRPC } from "@trpc/server";
import { telegramProcedure } from "./telegramAuth";

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
