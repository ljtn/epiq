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
