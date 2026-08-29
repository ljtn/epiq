// Doubling from half a second, so a server restart is picked up almost at once.
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;

// Past this the retries stop and the topbar offers the button instead. A server
// that has not come back in ~15s is usually down for a reason a retry loop
// cannot fix, and a silent loop gives the reader nothing to act on.
export const MAX_RECONNECT_ATTEMPTS = 5;

// The browser tests scale the schedule down rather than sit through it;
// nothing else sets this, and the shape of the schedule is unchanged.
declare global {
	interface Window {
		__epiqReconnectScale?: number;
	}
}

const scale = (): number =>
	typeof window === 'undefined' ? 1 : window.__epiqReconnectScale ?? 1;

/** How long to wait before attempt `attempt`, or null once they are spent. */
export const reconnectDelayMs = (attempt: number): number | null =>
	attempt >= MAX_RECONNECT_ATTEMPTS
		? null
		: Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt) * scale();
