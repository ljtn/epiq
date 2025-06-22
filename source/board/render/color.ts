/**
 * Applies ANSI color codes to a string for terminal output.
 * @param text The text to colorize
 * @param color One of: black, red, green, yellow, blue, magenta, cyan, white
 * @returns A colorized string using ANSI escape codes
 */
export function color(text: string, color: string): string {
	const colors: Record<string, string> = {
		black: '\x1b[30m',
		red: '\x1b[31m',
		green: '\x1b[32m',
		yellow: '\x1b[33m',
		blue: '\x1b[34m',
		magenta: '\x1b[35m',
		cyan: '\x1b[36m',
		white: '\x1b[37m',
		reset: '\x1b[0m',
	} as const;

	const code = colors[color.toLowerCase()] ?? '';
	return `${code}${text}${colors['reset']}`;
}
