export function findOverlap(wordA: string, wordB: string) {
	let overlap = 0;
	for (let i = 0; i < wordA.length; i++) {
		overlap++;
		if (wordB[i] !== wordA[i]) {
			break;
		}
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
