// A size on disk as a person reads it. Pure, so the GUI client shares it.
export const formatBytes = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;

	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}

	return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
};
