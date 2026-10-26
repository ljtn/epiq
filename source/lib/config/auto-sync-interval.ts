// How often auto sync runs, and what a valid value is. No imports, so any
// layer can read it without pulling in a sync loop.

/** The floor, in milliseconds: below it sync passes overlap. */
export const MIN_AUTO_SYNC_INTERVAL_MS = 3_000;

/**
 * The ceiling, in milliseconds: a day. `setTimeout` clamps a delay over 2^31−1
 * ms to 1 ms, which would spin the sync loop.
 */
export const MAX_AUTO_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** What an unset `autoSyncDebounceMs` means, wherever it is read. */
export const DEFAULT_AUTO_SYNC_INTERVAL_MS = 10_000;

/** A typed interval in whole milliseconds, or null. */
export const parseAutoSyncIntervalMs = (
	value: string | number,
): number | null => {
	const parsed = typeof value === 'number' ? value : Number(value.trim());

	if (!Number.isFinite(parsed)) return null;
	if (!Number.isInteger(parsed)) return null;
	if (parsed < MIN_AUTO_SYNC_INTERVAL_MS) return null;
	if (parsed > MAX_AUTO_SYNC_INTERVAL_MS) return null;

	return parsed;
};

/**
 * The delay a loop should wait, given whatever is on disk. Clamps only what
 * would spin or overflow; the floor is left to the doors, so tests can go fast.
 */
export const effectiveAutoSyncIntervalMs = (
	stored: number | null | undefined,
): number => {
	if (stored === null || stored === undefined || !Number.isFinite(stored)) {
		return DEFAULT_AUTO_SYNC_INTERVAL_MS;
	}

	return Math.min(MAX_AUTO_SYNC_INTERVAL_MS, Math.max(1, stored));
};
