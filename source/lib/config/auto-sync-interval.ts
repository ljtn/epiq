// How often auto sync runs, and what a valid answer to that is.
//
// One module because there are three askers — the TUI's `:config
// autosync-duration`, the GUI's identity panel, and the two sync loops
// themselves — and they were answering it differently: the floor lived beside
// the TUI's loop while the default was written out as `10_000` in three places
// and `15_000` in a fourth, so an unset config meant 10s in the TUI and 15s in
// the GUI. A panel that draws the number cannot be the fifth opinion.
//
// A leaf on purpose: no imports, so config, git and the GUI api can each read
// it without dragging a sync loop in behind it.

/**
 * The floor, in milliseconds.
 *
 * A sync is a fetch, a merge and a push against a remote; below a few seconds
 * the passes overlap more than they accomplish, and the lock they queue on is
 * shared with everything else the process wants to do.
 */
export const MIN_AUTO_SYNC_INTERVAL_MS = 3_000;

/** What an unset `autoSyncDebounceMs` means, wherever it is read. */
export const DEFAULT_AUTO_SYNC_INTERVAL_MS = 10_000;

/**
 * A typed interval, or null where it is not one.
 *
 * Integers only: the value is a millisecond count going into `setTimeout`, and
 * "3000.5" is a typo rather than a preference.
 */
export const parseAutoSyncIntervalMs = (
	value: string | number,
): number | null => {
	const parsed = typeof value === 'number' ? value : Number(value.trim());

	if (!Number.isFinite(parsed)) return null;
	if (!Number.isInteger(parsed)) return null;
	if (parsed < MIN_AUTO_SYNC_INTERVAL_MS) return null;

	return parsed;
};
