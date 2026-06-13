export const timeAgo = (timestampMs: number): string => {
	const diff = Date.now() - timestampMs;

	const units = [
		{label: 'y', ms: 1000 * 60 * 60 * 24 * 365},
		{label: 'mo', ms: 1000 * 60 * 60 * 24 * 30},
		{label: 'w', ms: 1000 * 60 * 60 * 24 * 7},
		{label: 'd', ms: 1000 * 60 * 60 * 24},
		{label: 'h', ms: 1000 * 60 * 60},
		{label: 'm', ms: 1000 * 60},
		{label: 's', ms: 1000},
	];

	for (const {label, ms} of units) {
		const value = Math.floor(diff / ms);
		if (value >= 1) return `${value}${label} ago`;
	}

	return 'just now';
};
