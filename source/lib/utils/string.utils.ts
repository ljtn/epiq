import stringWidth from 'string-width';

export function findOverlap(wordA: string, wordB: string): number {
	const max = Math.min(wordA.length, wordB.length);
	let overlap = 0;

	while (overlap < max && wordA[overlap] === wordB[overlap]) {
		overlap++;
	}

	return overlap;
}

export const truncateWithEllipsis = (value: string, width: number): string => {
	const ELLIPSIS = '...';
	if (width <= 0) return '';
	if (value.length <= width) return value;

	if (width <= ELLIPSIS.length) {
		return ELLIPSIS.slice(0, width);
	}

	return value.slice(0, width - ELLIPSIS.length) + ELLIPSIS;
};

const ANSI_SGR = /\u001B\[[0-9;]*m/;
const RESET = '\u001B[0m';

const graphemes = (value: string): string[] =>
	[
		...new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(value),
	].map(({segment}) => segment);

// Truncates by what the terminal draws rather than by code units: styling
// escapes cost no columns and a wide glyph costs two. A cut made while a style
// is open closes it, so it cannot bleed into the rest of the frame.
export const truncateToWidth = (value: string, width: number): string => {
	const ELLIPSIS = '...';
	if (width <= 0) return '';
	if (stringWidth(value) <= width) return value;

	if (width <= ELLIPSIS.length) {
		return ELLIPSIS.slice(0, width);
	}

	const budget = width - ELLIPSIS.length;

	let kept = '';
	let used = 0;
	let styled = false;

	for (const part of value.split(/(\u001B\[[0-9;]*m)/)) {
		if (part === '') continue;

		if (ANSI_SGR.test(part)) {
			kept += part;
			styled = part !== RESET && part !== '\u001B[m';
			continue;
		}

		for (const grapheme of graphemes(part)) {
			const cost = stringWidth(grapheme);
			if (used + cost > budget) {
				return `${kept}${ELLIPSIS}${styled ? RESET : ''}`;
			}

			kept += grapheme;
			used += cost;
		}
	}

	return `${kept}${ELLIPSIS}${styled ? RESET : ''}`;
};

export const sanitizeInlineText = (value: unknown): string => {
	if (typeof value !== 'string') {
		return '';
	}

	return value
		.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
		.replace(/[\r\n\t]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
};

export const capitalize = (str: string) =>
	str.charAt(0).toUpperCase() + str.slice(1);
