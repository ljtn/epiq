// `mounted` holds through the closing move; `shown` is false for the first
// frame, so there is a closed state to animate from; `settled` lifts clipping.

import {useEffect, useState} from 'react';

// The chrome's own pace, as the ticket panel's lanes collapse at.
export const REVEAL_MS = 180;

export const useReveal = (
	open: boolean,
	ms: number = REVEAL_MS,
): {mounted: boolean; shown: boolean; settled: boolean} => {
	const [mounted, setMounted] = useState(open);
	const [shown, setShown] = useState(open);
	const [settled, setSettled] = useState(open);

	useEffect(() => {
		// No motion: open now, without the two-frame stage.
		if (ms === 0) {
			setMounted(open);
			setShown(open);
			setSettled(open);

			return;
		}

		if (open) {
			setMounted(true);

			// Two frames: one still runs before the mount is painted.
			let second = 0;
			const first = requestAnimationFrame(() => {
				second = requestAnimationFrame(() => setShown(true));
			});
			const timer = setTimeout(() => setSettled(true), ms);

			return () => {
				cancelAnimationFrame(first);
				cancelAnimationFrame(second);
				clearTimeout(timer);
			};
		}

		setSettled(false);
		setShown(false);

		const timer = setTimeout(() => setMounted(false), ms);

		return () => clearTimeout(timer);
	}, [open, ms]);

	return {mounted, shown, settled};
};
