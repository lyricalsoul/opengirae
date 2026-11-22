import { test, expect, describe } from "bun:test";
import { bgImage } from "./css";

describe("bgImage", () => {
	test("quotes a plain url", () => {
		expect(bgImage("https://cdn.girae.io/a.jpg")).toBe('background-image: url("https://cdn.girae.io/a.jpg")');
	});

	test("keeps spaces and parentheses inside the quotes instead of ending the url early", () => {
		expect(bgImage("https://x.io/a b (1).jpg")).toBe('background-image: url("https://x.io/a b (1).jpg")');
	});

	test("a quote or backslash can't close the string and inject another declaration", () => {
		const out = bgImage('https://x.io/a"); background: red; x:("');
		expect(out).not.toContain('"); background');
		expect(out).toContain('\\22 ');
		expect(bgImage("a\\b")).toContain('\\5c ');
	});
});
