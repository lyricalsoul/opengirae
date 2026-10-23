// an unquoted url(...) breaks on spaces, parentheses and quotes in the address, and lets a crafted one inject further css declarations; quoting + escaping closes both.
export function bgImage(url: string): string {
	const escaped = url.replace(/[\\"\n\r]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
	return `background-image: url("${escaped}")`;
}
