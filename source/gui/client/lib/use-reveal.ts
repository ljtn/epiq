// Mounting and unmounting are instant; moving is not. A panel that is only
// rendered while it is open has no frame to move out in, and one rendered
// straight at its open size has nothing to move out from.
//
// `mounted` says whether to render at all, and is held for the length of the
// closing move. `shown` is the size to draw at, and is false for the first
// frame after a mount, so the browser has a closed state to interpolate from.
// `settled` says the move is over: what clips a panel on its way in and out has
// to let go of it once it is open, or it spends the rest of its life cutting
// off whatever the panel draws past its own edges.

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
		if (open) {
			setMounted(true);

			// Two frames rather than one. A single callback still runs before the
			// browser has painted the mount, so both sizes land in one frame and
			// there is nothing between them to animate; the second frame is the
			// one that can only come after the closed state was drawn.
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
