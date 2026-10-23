import React, {useEffect, useRef, useState} from 'react';

// A section's add row — the tag or assignee picker under a ticket — open for
// as long as focus is inside its section. Keyboard focus arriving opens it in
// its input; focus leaving, by a click elsewhere or a Tab out, closes it. A
// press inside the open section keeps focus in the input, so picking a chip
// or pressing Add or - lands before any blur could close the row under it.
//
// Focus taken by a press elsewhere closes the row only once that press is
// over: closing it at once lifts everything under it, and the release lands
// on whatever moved there, so the click that took the focus is lost.
export const useAddRow = () => {
	const [open, setOpen] = useState(false);
	const [focusPending, setFocusPending] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const pressing = useRef(false);

	useEffect(() => {
		if (!open) return;

		const down = () => (pressing.current = true);
		const up = () => (pressing.current = false);
		document.addEventListener('pointerdown', down, true);
		document.addEventListener('pointerup', up, true);

		return () => {
			document.removeEventListener('pointerdown', down, true);
			document.removeEventListener('pointerup', up, true);
		};
	}, [open]);

	// After the render that mounts the input.
	useEffect(() => {
		if (!open || !focusPending) return;

		inputRef.current?.focus();
		setFocusPending(false);
	}, [open, focusPending]);

	const start = () => {
		setOpen(true);
		setFocusPending(true);
	};

	const close = () => setOpen(false);

	const sectionProps = {
		// Keyboard only: a click on a chip, which removes it, is not a way in.
		onFocus: (event: React.FocusEvent) => {
			if (open || !(event.target as HTMLElement).matches(':focus-visible')) {
				return;
			}

			start();
		},
		onBlur: (event: React.FocusEvent) => {
			const section = event.currentTarget;
			if (section.contains(event.relatedTarget as Node | null)) return;

			if (!pressing.current) return close();

			// After the click the release makes, which the same task dispatches.
			document.addEventListener(
				'pointerup',
				() =>
					setTimeout(() => {
						if (!section.contains(document.activeElement)) close();
					}),
				{once: true, capture: true},
			);
		},
		onMouseDown: (event: React.MouseEvent) => {
			if (open && event.target !== inputRef.current) event.preventDefault();
		},
	};

	return {open, start, close, inputRef, sectionProps};
};
