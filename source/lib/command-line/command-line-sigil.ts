import {CONFIRM_MSG} from './command-validation.js';

// The sigil while a command runs: the colon's two dots walking a braille cell, one column wide.
export const PENDING_FRAMES = ['⠃', '⠆', '⠰', '⠘'] as const;

export const PENDING_FRAME_MS = 120;

// The head of the command line, animated while a command runs.
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

// Hides "<ENTER> to confirm" while the command runs. `includes`, since the
// message arrives wrapped in escape codes.
export const commandLineHint = ({
	infoMessage,
	isPending,
}: {
	infoMessage: string;
	isPending: boolean;
}): string =>
	isPending && infoMessage.includes(CONFIRM_MSG) ? '' : infoMessage;
