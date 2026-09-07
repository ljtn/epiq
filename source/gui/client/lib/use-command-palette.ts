import {useEffect, useState} from 'react';

/**
 * Whether the palette is open, and the one key that opens it.
 *
 * `Cmd/Ctrl+K` throughout, which is what every other board has trained people
 * to reach for. Registered on the document rather than on a container, since the
 * point is that it works wherever the focus happens to be — and captured before
 * the browser's own find-in-page binding on the same chord.
 *
 * Held out of a field: somebody typing a ticket title should get a `k`, not a
 * palette over what they were writing.
 */
const isTypingTarget = (target: EventTarget | null): boolean => {
	const element = target as HTMLElement | null;
	if (!element) return false;

	const tag = element.tagName;

	return (
		tag === 'INPUT' ||
		tag === 'TEXTAREA' ||
		tag === 'SELECT' ||
		element.isContentEditable
	);
};

export const useCommandPalette = (): {
	open: boolean;
	setOpen: (next: boolean) => void;
} => {
	const [open, setOpen] = useState(false);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'k' || !(event.metaKey || event.ctrlKey)) return;

			// The palette's own input is a typing target, so closing on the same
			// chord has to come before that check.
			if (!open && isTypingTarget(event.target)) return;

			event.preventDefault();
			setOpen(!open);
		};

		document.addEventListener('keydown', onKeyDown);

		return () => document.removeEventListener('keydown', onKeyDown);
	}, [open]);

	return {open, setOpen};
};
