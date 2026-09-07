import {CONFIRM_MSG} from './command-validation.js';

// The sigil, while a confirmed command is still running. Two dots — the colon
// itself — walking the corners of the braille cell: one column wide, so nothing
// on the line shifts under it, and the same quiet register as the sync badge's
// drift rather than a spinner competing with the board for attention.
export const PENDING_FRAMES = ['⠃', '⠆', '⠰', '⠘'] as const;

export const PENDING_FRAME_MS = 120;

// What sits at the head of the command line. A running command animates the
// colon in place: the line reads as busy without a word being added to it, and
// idle it is the plain sigil it has always been.
export const commandLineSigil = ({
	isPalette,
	isPending,
	frame,
}: {
	isPalette: boolean;
	isPending: boolean;
	frame: number;
}): string => {
	if (isPending) {
		const at =
			((frame % PENDING_FRAMES.length) + PENDING_FRAMES.length) %
			PENDING_FRAMES.length;

		return PENDING_FRAMES[at]!;
	}

	return isPalette ? '?' : ':';
};

// "<ENTER> to confirm" is an instruction, and once the command is running it is
// the wrong one — pressing Enter again is exactly what somebody does when a
// slow command looks like it never landed. Every other message stays put: a
// failed result arrives while pending is still true, and that one has to show.
//
// Matched on rather than compared: the message arrives styled, wrapped in the
// escape codes `hintDefault` paints it with, so equality against the bare
// string silently never holds.
export const commandLineHint = ({
	infoMessage,
	isPending,
}: {
	infoMessage: string;
	isPending: boolean;
}): string =>
	isPending && infoMessage.includes(CONFIRM_MSG) ? '' : infoMessage;
