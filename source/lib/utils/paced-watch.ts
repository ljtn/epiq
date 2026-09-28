/**
 * Runs `check` on a timer until stopped. The pause is at least as long as the
 * last run took, so a slow check on a large board cannot keep its process
 * busy back to back.
 */
export const startPacedWatch = (
	check: () => Promise<unknown>,
	intervalMs: number,
): (() => void) => {
	let timer: NodeJS.Timeout | undefined;
	let stopped = false;

	const tick = async () => {
		const startedAt = Date.now();

		try {
			await check();
		} catch (error) {
			// Unattended and on a timer: a throw here must not stop the watch.
			logger.error('[watch] check threw', error);
		}

		if (stopped) return;

		timer = setTimeout(tick, Math.max(intervalMs, Date.now() - startedAt));
	};

	timer = setTimeout(tick, intervalMs);

	return () => {
		stopped = true;
		if (timer) clearTimeout(timer);
	};
};
