// Closes on a click anywhere else or on Escape, which is the half of
// "dropdown" that a bare toggle leaves out.

import {useEffect, useRef} from 'react';

/**
 * `alsoInside` is for a panel that is not a descendant of the trigger — one
 * rendered through a portal to escape a clipping ancestor. Without it every
 * click inside such a panel reads as a click outside, and it closes the moment
 * it is used.
 */
export const useDismissOnOutsideClick = (
	open: boolean,
	onDismiss: () => void,
	alsoInside: React.RefObject<HTMLElement | null>[] = [],
): React.RefObject<HTMLDivElement | null> => {
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;

		const onPointerDown = (event: MouseEvent) => {
			const target = event.target as Node;
			const inside =
				ref.current?.contains(target) ||
				alsoInside.some(other => other.current?.contains(target));

			if (!inside) onDismiss();
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onDismiss();
		};

		document.addEventListener('mousedown', onPointerDown);
		document.addEventListener('keydown', onKeyDown);

		return () => {
			document.removeEventListener('mousedown', onPointerDown);
			document.removeEventListener('keydown', onKeyDown);
		};
		// `alsoInside` is a fresh array each render and is read through its refs
		// when a click arrives, never captured, so it is deliberately not a
		// dependency: listing it would tear these listeners down and re-add them
		// on every render for no change in behaviour.
	}, [open, onDismiss]);

	return ref;
};
