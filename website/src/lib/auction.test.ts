import { test, expect, describe } from "bun:test";
import { formatTimeLeft, minimumBidFor } from "./auction";

describe("formatTimeLeft", () => {
	const now = Date.UTC(2026, 0, 1, 12, 0, 0);
	const at = (ms: number) => new Date(now + ms).toISOString();

	test("hours and minutes, then minutes and zero-padded seconds, then the ending state", () => {
		expect(formatTimeLeft(at(2 * 3_600_000 + 5 * 60_000), now)).toBe("2h 5min");
		expect(formatTimeLeft(at(90_000 + 5_000), now)).toBe("1min 35s");
		expect(formatTimeLeft(at(61_000), now)).toBe("1min 01s");
		expect(formatTimeLeft(at(0), now)).toBe("Terminando...");
		expect(formatTimeLeft(at(-5_000), now)).toBe("Terminando...");
	});
});

describe("minimumBidFor", () => {
	const now = Date.UTC(2026, 0, 1, 12, 0, 0);
	const base = { startingBid: 1000, bidIncrement: 500, overtimeIncrement: 2000, capPrice: 3000, currentBid: null as number | null, expiresAt: new Date(now + 3_600_000).toISOString() };

	test("opens at the starting bid, then steps by the increment", () => {
		expect(minimumBidFor(base, now)).toBe(1000);
		expect(minimumBidFor({ ...base, currentBid: 1500 }, now)).toBe(2000);
	});

	test("uses the overtime increment in the last 2 minutes", () => {
		const closing = { ...base, currentBid: 1000, expiresAt: new Date(now + 60_000).toISOString() };
		expect(minimumBidFor(closing, now)).toBe(3000);
	});

	test("never asks for more than the cap, so the cap price stays biddable", () => {
		expect(minimumBidFor({ ...base, currentBid: 2800 }, now)).toBe(3000);
	});
});
