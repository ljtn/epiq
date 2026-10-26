import {useEffect, useState} from 'react';

/**
 * Whether the palette is open, and `Cmd/Ctrl+K` to open it from anywhere,
 * ahead of find-in-page. Not while typing in a field.
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
			const chord = event.key === 'k' && (event.metaKey || event.ctrlKey);

			// `:` as in the TUI, only where nothing is being typed. `?` stays the web's
			// shortcuts key.
			const colon = event.key === ':' && !event.metaKey && !event.ctrlKey;

			if (!chord && !colon) return;

			// The palette's own input is a typing target, so closing on the same
			// chord has to come before that check.
			if (!open && isTypingTarget(event.target)) return;

			// Only the chord toggles: `:` typed at an open palette is a character
			// its own field should receive, and it never reaches here anyway.
			if (open && !chord) return;

			event.preventDefault();
			setOpen(!open);
		};

		document.addEventListener('keydown', onKeyDown);

		return () => document.removeEventListener('keydown', onKeyDown);
	}, [open]);

	return {open, setOpen};
};
