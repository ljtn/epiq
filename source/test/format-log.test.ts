import {describe, expect, it} from 'vitest';
import {materializeAll} from '../lib/event/event-materialize.js';
import {AppEvent} from '../lib/event/event.model.js';
import {describeEvent, formatLogLine} from '../lib/event/format-log-utils.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {nodes} from '../lib/state/node-builder.js';
import {initWorkspaceState} from '../lib/state/state.js';
import {bigIntToHex} from '../lib/utils/rank.js';

const stripAnsi = (value: string): string =>
	// eslint-disable-next-line no-control-regex
	value.replace(/\x1B\[[0-9;]*m/g, '');

const actor = {userId: 'u1', userName: 'alice'};

const event = <A extends AppEvent['action']>(
	id: string,
	action: A,
	payload: Extract<AppEvent, {action: A}>['payload'],
): Extract<AppEvent, {action: A}> =>
	({id, action, payload, ...actor} as Extract<AppEvent, {action: A}>);

describe('attachment history log entries', () => {
	const addEvent = event('01H00000000000000000000101', 'add.issue.attachment', {
		id: '01H00000000000000000000201',
		issue: '01H00000000000000000000005',
		author: actor.userId,
		hash: 'a'.repeat(64),
		ext: 'png',
		name: 'screenshot.png',
		bytes: 68 * 1024,
	});

	const deleteEvent = event(
		'01H00000000000000000000102',
		'delete.issue.attachment',
		{
			id: '01H00000000000000000000201',
			issue: '01H00000000000000000000005',
		},
	);

	it('formats add.issue.attachment with name and size', () => {
		const line = stripAnsi(formatLogLine(addEvent, []));

		expect(line).toContain('Attached "screenshot.png" (68 KB)');
		expect(line).toContain('alice');
	});

	it('describes add.issue.attachment for the replay caption', () => {
		expect(describeEvent(addEvent)).toBe('Attached "screenshot.png" (68 KB)');
	});

	it('resolves the deleted attachment name from state', () => {
		const rankResult = bigIntToHex(1n);
		if (isFail(rankResult)) throw new Error(rankResult.message);
		initWorkspaceState(
			nodes.workspace('01H00000000000000000000001', 'W', rankResult.value),
		);

		const setup = materializeAll([
			event('01H00000000000000000000103', 'add.board', {
				id: '01H00000000000000000000002',
				name: 'B',
				parent: '01H00000000000000000000001',
				rank: 'a0',
			}),
			event('01H00000000000000000000104', 'add.swimlane', {
				id: '01H00000000000000000000003',
				name: 'S',
				parent: '01H00000000000000000000002',
				rank: 'a0',
			}),
			event('01H00000000000000000000105', 'add.issue', {
				id: '01H00000000000000000000005',
				name: 'Issue',
				parent: '01H00000000000000000000003',
				rank: 'a0',
			}),
			addEvent,
		] as const);
		for (const result of setup as readonly Result[]) {
			expect(isFail(result)).toBe(false);
		}

		const line = stripAnsi(formatLogLine(deleteEvent, []));
		expect(line).toContain('Removed attachment "screenshot.png"');
	});

	it('describes delete without state as a bare removal', () => {
		// no attachment in state: falls back to the verb alone
		expect(
			describeEvent(
				event('01H00000000000000000000106', 'delete.issue.attachment', {
					id: 'missing',
					issue: 'x',
				}),
			),
		).toBe('Removed attachment');
	});
});
