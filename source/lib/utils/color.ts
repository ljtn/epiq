import chalk from 'chalk';

const stringHash = (value: string): number => {
	let hash = 0;

	for (let i = 0; i < value.length; i++) {
		hash = value.charCodeAt(i) + ((hash << 5) - hash);
		hash |= 0;
	}

	return Math.abs(hash);
};

const hslToHex = (h: number, s: number, l: number): string => {
	s /= 100;
	l /= 100;

	const c = (1 - Math.abs(2 * l - 1)) * s;
	const hh = h / 60;
	const x = c * (1 - Math.abs((hh % 2) - 1));

	let r = 0;
	let g = 0;
	let b = 0;

	if (hh >= 0 && hh < 1) {
		r = c;
		g = x;
	} else if (hh >= 1 && hh < 2) {
		r = x;
		g = c;
	} else if (hh >= 2 && hh < 3) {
		g = c;
		b = x;
	} else if (hh >= 3 && hh < 4) {
		g = x;
		b = c;
	} else if (hh >= 4 && hh < 5) {
		r = x;
		b = c;
	} else {
		r = c;
		b = x;
	}

	const m = l - c / 2;
	const toHex = (value: number): string =>
		Math.round((value + m) * 255)
			.toString(16)
			.padStart(2, '0');

	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

export const stringToHslHexColor = (value: string): string => {
	const hash = stringHash(value);

	const hue = hash % 360;
	const saturation = 65;
	const lightness = 45;

	return hslToHex(hue, saturation, lightness);
};

// =========================
// =========================
// =========================
// =========================
// =========================

const gradientStops: [number, number, number][] = [
	[168, 139, 250], // soft neon lavender
	[59, 130, 246], // vivid blue core
	[34, 211, 238], // bright cyan edge
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const interpolateColor = (
	a: [number, number, number],
	b: [number, number, number],
	t: number,
): [number, number, number] => [
	Math.round(lerp(a[0], b[0], t)),
	Math.round(lerp(a[1], b[1], t)),
	Math.round(lerp(a[2], b[2], t)),
];

export const getGradientColor = (t: number): [number, number, number] => {
	const clamped = Math.max(0, Math.min(1, t));
	const segments = gradientStops.length - 1;
	const scaled = clamped * segments;
	const index = Math.min(Math.floor(scaled), segments - 1);
	const localT = scaled - index;

	if (gradientStops) {
		return interpolateColor(
			gradientStops[index]!,
			gradientStops[index + 1]!,
			localT,
		);
	}
	return [0, 0, 0];
};

// Stable string hash
const hashString = (input: string): number => {
	let hash = 0;
	for (let i = 0; i < input.length; i++) {
		hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
	}
	return hash;
};

// Stable gradient position for a word: 0..1
export const getWordGradientPosition = (word: string): number => {
	const hash = hashString(word.toLowerCase().trim());
	return hash / 0xffffffff;
};

export const getGradientWordStyle = (word: string) => {
	const t = getWordGradientPosition(word);
	const [r, g, b] = getGradientColor(t);

	return {
		normal: (text: string) => chalk.bgRgb(r, g, b).black(text),
		cursor: (text: string) => chalk.bgRgb(r, g, b).white.bold(text),
	};
};

export const getGradientStyles = (word: string) => {
	const t = getWordGradientPosition(word);
	const [r, g, b] = getGradientColor(t);

	return {
		// command style (foreground only)
		fg: (text: string) => chalk.rgb(r, g, b)(text),
		fgCursor: (text: string) => chalk.rgb(r, g, b).inverse(text),

		// modifier style (background)
		bg: (text: string) => chalk.bgRgb(r, g, b).black(text),
		bgCursor: (text: string) => chalk.bgRgb(r, g, b).white.bold(text),
	};
};

export const getGradientWord = (word: string) => {
	return getGradientWordStyle(word).normal(` ${word} `);
};
