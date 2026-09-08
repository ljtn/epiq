const DURATION_UNITS = [
	{label: 'y', ms: 1000 * 60 * 60 * 24 * 365},
	{label: 'mo', ms: 1000 * 60 * 60 * 24 * 30},
	{label: 'w', ms: 1000 * 60 * 60 * 24 * 7},
	{label: 'd', ms: 1000 * 60 * 60 * 24},
	{label: 'h', ms: 1000 * 60 * 60},
	{label: 'm', ms: 1000 * 60},
	{label: 's', ms: 1000},
];

// A span in its largest whole unit. Empty below a second, which is a length no
// unit here can put a number on — callers word that end of the scale for
// themselves.
export const formatDuration = (ms: number): string => {
	for (const {label, ms: unit} of DURATION_UNITS) {
		const value = Math.floor(ms / unit);
		if (value >= 1) return `${value}${label}`;
	}

	return '';
};

export const timeAgo = (timestampMs: number): string => {
	const elapsed = formatDuration(Date.now() - timestampMs);

	return elapsed === '' ? 'just now' : `${elapsed} ago`;
};

// Full date for the hover title beside a relative one, so an exact timestamp is
// always one hover away.
export const formatAbsolute = (timestampMs: number): string =>
	new Date(timestampMs).toLocaleString(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short',
	});
