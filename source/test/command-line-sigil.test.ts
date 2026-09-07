import {describe, expect, it} from 'vitest';
import {CONFIRM_MSG} from '../lib/command-line/command-validation.js';
import {
	commandLineHint,
	commandLineSigil,
	PENDING_FRAMES,
} from '../lib/command-line/command-line-sigil.js';

const sigil = (isPending: boolean, frame = 0, isPalette = false) =>
	commandLineSigil({isPalette, isPending, frame});

describe('the command line sigil', () => {
	it('is the plain colon, or the palette mark, while nothing is running', () => {
		expect(sigil(false)).toBe(':');
		expect(sigil(false, 0, true)).toBe('?');
	});

	// The whole point: a running command has to look different from one that was
	// typed and never submitted, or the reader presses Enter again.
	it('is never the idle sigil while a command is running', () => {
		for (let frame = 0; frame < PENDING_FRAMES.length * 3; frame++) {
			expect(sigil(true, frame)).not.toBe(':');
			expect(sigil(true, frame, true)).not.toBe('?');
		}
	});

	it('walks every frame and comes back round', () => {
		const walked = PENDING_FRAMES.map((_, frame) => sigil(true, frame));

		expect(walked).toEqual([...PENDING_FRAMES]);
		expect(sigil(true, PENDING_FRAMES.length)).toBe(PENDING_FRAMES[0]);
	});

	// One column, so the line cannot shift under it as it animates.
	it('is one character wide, whatever it says', () => {
		for (const frame of [0, 1, 2, 3]) {
			expect([...sigil(true, frame)]).toHaveLength(1);
		}
		expect([...sigil(false)]).toHaveLength(1);
	});
});

describe('the command line hint', () => {
	// As it actually arrives: `hintDefault` paints it, so the string carries the
	// dim escape codes around it and never equals the bare constant.
	const styled = `\u001b[2m${CONFIRM_MSG}\u001b[22m`;

	it('drops the confirm instruction once the command is running', () => {
		expect(commandLineHint({infoMessage: CONFIRM_MSG, isPending: true})).toBe(
			'',
		);
		expect(commandLineHint({infoMessage: CONFIRM_MSG, isPending: false})).toBe(
			CONFIRM_MSG,
		);
	});

	it('drops it however it was styled on the way in', () => {
		expect(commandLineHint({infoMessage: styled, isPending: true})).toBe('');
		expect(commandLineHint({infoMessage: styled, isPending: false})).toBe(
			styled,
		);
	});

	// A failed result arrives while pending is still true, and it is the one
	// thing the reader needs.
	it('keeps every other message, pending or not', () => {
		for (const isPending of [true, false]) {
			expect(commandLineHint({infoMessage: 'Command failed', isPending})).toBe(
				'Command failed',
			);
		}
	});
});
