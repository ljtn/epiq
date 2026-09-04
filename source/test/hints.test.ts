import {describe, expect, it} from 'vitest';
import {getActionHints, parseActionHint} from '../lib/hints/hints.js';
import {ActionEntry, Mode} from '../lib/model/action-map.model.js';
import {succeeded} from '../lib/model/result-types.js';

const entry = (
	description: string | undefined,
	mode: ActionEntry['mode'] = Mode.DEFAULT,
): ActionEntry => ({
	mode,
	description: description as ActionEntry['description'],
	action: () => succeeded('noop', null),
});

describe('parseActionHint', () => {
	it('splits `[keys] label`', () => {
		expect(parseActionHint('[n] new...')).toEqual({keys: 'n', label: 'new...'});
		expect(parseActionHint('[<Enter>] confirm/enter')).toEqual({
			keys: '<Enter>',
			label: 'confirm/enter',
		});
	});

	it('rejects a description without a key group', () => {
		expect(parseActionHint('navigate')).toBeNull();
	});
});

describe('getActionHints', () => {
	it('lists only the current mode, single keys first, in declaration order', () => {
		const hints = getActionHints(
			[
				entry('[?] all commands'),
				entry('[n] new...'),
				entry('[<Enter>] confirm/enter'),
				entry(undefined),
				entry('[d] delete'),
				entry('[arrows/hjkl] navigate'),
				entry('[<Esc>] cancel', Mode.MOVE),
				entry('[m] move (init/confirm)'),
			],
			Mode.DEFAULT,
		);

		expect(hints.map(hint => hint.keys)).toEqual([
			'?',
			'n',
			'd',
			'm',
			'<Enter>',
			'arrows/hjkl',
		]);
	});

	it('collapses actions that share a description', () => {
		const hints = getActionHints(
			[entry('[arrows/hjkl] navigate'), entry('[arrows/hjkl] navigate')],
			Mode.DEFAULT,
		);

		expect(hints).toHaveLength(1);
	});
});
