import {describe, expect, it} from 'vitest';
import {
	MAX_COMMENT_LENGTH,
	MAX_DESCRIPTION_LENGTH,
	MAX_TITLE_LENGTH,
} from '../../../lib/utils/text.limits.js';
import {MAX_SOCKET_FRAME_BYTES} from './websocket.js';

// A character can reach four bytes as UTF-8, and JSON escaping can grow it
// further; the frame also carries the envelope around the field.
const worstCaseBytes = (characters: number) => characters * 6 + 1024;

describe('the websocket frame ceiling', () => {
	// The risk of setting a ceiling at all: it must never be the thing that
	// stops a legitimate save. Every field this socket carries has a cap of its
	// own, and the frame has to clear the largest of them with room to spare.
	it('clears the largest message the socket legitimately carries', () => {
		const largest = Math.max(
			MAX_DESCRIPTION_LENGTH,
			MAX_COMMENT_LENGTH,
			MAX_TITLE_LENGTH,
		);

		expect(MAX_SOCKET_FRAME_BYTES).toBeGreaterThan(worstCaseBytes(largest));
	});

	// And the reason it exists: `ws` defaults to 100 MiB, which is buffered and
	// parsed before any handler — so before the caps above get a say.
	it('is far below what ws would otherwise allow', () => {
		const WS_DEFAULT_MAX_PAYLOAD = 100 * 1024 * 1024;

		expect(MAX_SOCKET_FRAME_BYTES).toBeLessThan(WS_DEFAULT_MAX_PAYLOAD / 10);
	});
});
