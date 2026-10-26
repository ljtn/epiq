import React, {useEffect, useRef, useState} from 'react';

// A section's add row, open while focus is inside its section. A press
// elsewhere closes it only once released, or the click lands on what moved.
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
		// A cancel ends a press too — a touch turned scroll, the OS taking the
		// pointer — or a later Tab out would wait for some unrelated click.
		document.addEventListener('pointerup', up, true);
		document.addEventListener('pointercancel', up, true);

		return () => {
			document.removeEventListener('pointerdown', down, true);
			document.removeEventListener('pointerup', up, true);
			document.removeEventListener('pointercancel', up, true);
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
			const settle = () => {
				document.removeEventListener('pointerup', settle, true);
				document.removeEventListener('pointercancel', settle, true);
				setTimeout(() => {
					if (!section.contains(document.activeElement)) close();
				});
			};
			document.addEventListener('pointerup', settle, true);
			document.addEventListener('pointercancel', settle, true);
		},
		onMouseDown: (event: React.MouseEvent) => {
			if (open && event.target !== inputRef.current) event.preventDefault();
		},
	};

	return {open, start, close, inputRef, sectionProps};
};
