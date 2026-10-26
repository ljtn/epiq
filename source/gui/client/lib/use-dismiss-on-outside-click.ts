// Closes on a click anywhere else or on Escape, which is the half of
// "dropdown" that a bare toggle leaves out.

import {useEffect, useRef} from 'react';

/**
 * `alsoInside`: a portalled panel that counts as inside. `nested`: takes Escape
 * before an outer closer. `escape: false`: Escape is the caller's.
 */
export const useDismissOnOutsideClick = (
	open: boolean,
	onDismiss: () => void,
	alsoInside: React.RefObject<HTMLElement | null>[] = [],
	{nested = false, escape = true}: {nested?: boolean; escape?: boolean} = {},
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
			if (event.key !== 'Escape' || event.defaultPrevented) return;
			if (nested) event.preventDefault();
			onDismiss();
		};

		document.addEventListener('mousedown', onPointerDown);
		if (escape)
			document.addEventListener('keydown', onKeyDown, {capture: nested});

		return () => {
			document.removeEventListener('mousedown', onPointerDown);
			document.removeEventListener('keydown', onKeyDown, {capture: nested});
		};
		// `alsoInside` is read through refs on click, so it is not a dependency.
	}, [open, onDismiss, nested, escape]);

	return ref;
};
