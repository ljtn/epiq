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

/**
 * The ceiling, in milliseconds: a day.
 *
 * Not a taste question. `setTimeout` takes a signed 32-bit delay, and anything
 * over 2^31−1 ms is silently clamped to **1 ms** — so an interval set too long
 * becomes a sync loop running flat out against the remote, which is the
 * opposite of what was asked for. The two fields make that easy to reach by
 * accident: `:config autosync-duration` takes milliseconds and the identity
 * panel takes seconds, so anybody carrying the TUI's `3600000` over to the
 * panel would land on 3.6e9 ms.
 *
 * A day is far past any useful cadence and three weeks short of the overflow.
 */
export const MAX_AUTO_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

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
	if (parsed > MAX_AUTO_SYNC_INTERVAL_MS) return null;

	return parsed;
};

/**
 * The delay a loop should actually wait, given whatever is on disk.
 *
 * Both loops read `autoSyncDebounceMs` straight from the config file, which is
 * not only ever written through `parseAutoSyncIntervalMs`: it is hand-editable,
 * it predates these bounds, and the suites write values into it directly. So
 * the ceiling has to hold here as well as at the doors — past it `setTimeout`
 * inverts a too-long interval into a 1 ms one, and a cadence nobody could type
 * would hammer the remote.
 *
 * The *floor* is deliberately not applied here. It is policy the two doors
 * enforce on what a person may ask for, not a correctness bound, and a test or
 * a fixture that wants the loop to turn over quickly is entitled to say so.
 * Only a delay that would stall or spin is corrected: non-positive values,
 * which busy-loop, and anything past the ceiling.
 */
export const effectiveAutoSyncIntervalMs = (
	stored: number | null | undefined,
): number => {
	if (stored === null || stored === undefined || !Number.isFinite(stored)) {
		return DEFAULT_AUTO_SYNC_INTERVAL_MS;
	}

	return Math.min(MAX_AUTO_SYNC_INTERVAL_MS, Math.max(1, stored));
};
