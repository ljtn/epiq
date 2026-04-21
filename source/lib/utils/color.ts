import chalk from 'chalk';
import {TAGS_DEFAULT} from '../static/default-tags.js';

type Rgb = [number, number, number];

export const colorConfig = {
	stringColor: {
		saturation: 50,
		lightness: 60,
	},

	gradient: {
		stops: [
			[174, 150, 240], // soft lavender
			[92, 138, 232], // clearer blue
			[102, 204, 226], // lively cyan
		] as Rgb[],
	},
};

// =========================
// shared primitives
// =========================

const clamp = (value: number, min: number, max: number) =>
	Math.max(min, Math.min(max, value));

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const hashString = (value: string): number => {
	let hash = 0;

	for (let i = 0; i < value.length; i++) {
		hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
	}

	return hash;
};

const hslToRgb = (h: number, s: number, l: number): Rgb => {
	const sat = s / 100;
	const light = l / 100;

	const c = (1 - Math.abs(2 * light - 1)) * sat;
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

	const m = light - c / 2;

	return [
		Math.round((r + m) * 255),
		Math.round((g + m) * 255),
		Math.round((b + m) * 255),
	];
};

const rgbToHex = ([r, g, b]: Rgb): string =>
	`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b
		.toString(16)
		.padStart(2, '0')}`;

const interpolateColor = (a: Rgb, b: Rgb, t: number): Rgb => [
	Math.round(lerp(a[0], b[0], t)),
	Math.round(lerp(a[1], b[1], t)),
	Math.round(lerp(a[2], b[2], t)),
];

// =========================
// string-based single color
// =========================

export const stringToHslHexColor = (value: string): string => {
	const hash = hashString(value);
	const hue = hash % 360;

	const rgb = hslToRgb(
		hue,
		colorConfig.stringColor.saturation,
		colorConfig.stringColor.lightness,
	);

	return rgbToHex(rgb);
};

// =========================
// gradient helpers
// =========================

export const getGradientColor = (t: number): Rgb => {
	const stops = colorConfig.gradient.stops;
	const clamped = clamp(t, 0, 1);

	if (stops.length === 0) return [0, 0, 0];
	if (stops.length === 1) return stops[0]!;

	const segments = stops.length - 1;
	const scaled = clamped * segments;
	const index = Math.min(Math.floor(scaled), segments - 1);
	const localT = scaled - index;

	return interpolateColor(stops[index]!, stops[index + 1]!, localT);
};

export const getWordGradientPosition = (word: string): number => {
	const hash = hashString(word.toLowerCase().trim());
	return hash / 0xffffffff;
};

const getWordGradientRgb = (word: string): Rgb => {
	const t = getWordGradientPosition(word);
	return getGradientColor(t);
};

export const getGradientWordStyle = (word: string) => {
	const [r, g, b] = getWordGradientRgb(word);

	return {
		normal: (text: string) => chalk.bgRgb(r, g, b).black(text),
		cursor: (text: string) => chalk.bgRgb(r, g, b).white.bold(text),
	};
};

export const getGradientStyles = (word: string) => {
	const [r, g, b] = getWordGradientRgb(word);

	return {
		fg: (text: string) => chalk.rgb(r, g, b)(text),
		fgCursor: (text: string) => chalk.rgb(r, g, b).inverse(text),
		bg: (text: string) => chalk.bgRgb(r, g, b).black(text),
		bgCursor: (text: string) => chalk.bgRgb(r, g, b).white.bold(text),
	};
};

export const getGradientWord = (word: string) => {
	return getGradientWordStyle(word).normal(` ${word} `);
};

export const getStringColor = (id: string, config = TAGS_DEFAULT): string => {
	const normalizeName = (value: string): string => value.toLowerCase().trim();
	const normalized = normalizeName(id);
	if (normalized && config[normalized]) return config[normalized];
	return stringToHslHexColor(normalized);
};
