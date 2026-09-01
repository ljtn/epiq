/**
 * The payload check sits between "this build knows the action" and "a handler
 * dereferences the payload", so it has two ways to be wrong, and the expensive
 * one is not the obvious one.
 *
 * Rejecting junk is what it is for. Rejecting something a *newer* epiq wrote —
 * an added field, a value this build has no opinion about — would quarantine
 * events this build can apply perfectly well, on every clone, permanently.
 */
import {describe, expect, it} from 'vitest';
import {createDefaultEvents} from '../lib/event/event-boot.js';
import {createIssueEvents} from '../lib/event/common-events.js';
import {EVENT_ACTIONS} from '../lib/event/event.model.js';
import {parseEventPayload} from '../lib/event/event-payload.schema.js';
import {isFail} from '../lib/model/result-types.js';

const ID = '01M1FD32E0323ZNXEKCY8YK9JR';
const RANK = '800000000000000000000000';

const accepts = (action: string, payload: unknown): boolean =>
	!isFail(parseEventPayload(action as never, payload));

describe('parseEventPayload', () => {
	it('has a schema for every action this build knows', () => {
		// A new action with no schema would throw on `safeParse` of undefined,
		// which is the failure mode this whole check exists to remove.
		for (const action of EVENT_ACTIONS) {
			expect(() => parseEventPayload(action, {}), action).not.toThrow();
		}
	});

	// The strongest form of "does not reject what we write": run the real
	// constructors rather than hand-written samples that can drift from them.
	it('accepts every event a fresh project writes', () => {
		const defaults = createDefaultEvents({userId: ID, userName: 'ana'});
		expect(isFail(defaults)).toBe(false);
		if (isFail(defaults)) return;

		for (const event of defaults.value) {
			const result = parseEventPayload(event.action, event.payload);
			expect(isFail(result), `${event.action}: ${result.message}`).toBe(false);
		}
	});

	it('accepts the events an issue creation writes', () => {
		const events = createIssueEvents({
			name: 'a ticket',
			parent: ID,
			rank: RANK,
			user: {userId: ID, userName: 'ana'},
		});

		expect(isFail(events)).toBe(false);
		if (isFail(events)) return;

		for (const event of events.value) {
			expect(isFail(parseEventPayload(event.action, event.payload))).toBe(
				false,
			);
		}
	});

	it('accepts a payload carrying a field this build does not know', () => {
		expect(
			accepts('add.issue', {
				id: ID,
				name: 'from a newer epiq',
				parent: ID,
				rank: RANK,
				estimate: 5,
			}),
		).toBe(true);
	});

	/**
	 * Found by running this check over the live board rather than by reading
	 * the types: an `add.issue.attachment` there carries no `author`, the
	 * declared field notwithstanding. The handler never reads it. Requiring it
	 * would have made that attachment disappear from every clone.
	 */
	it('accepts a comment and an attachment written without an author', () => {
		expect(accepts('add.issue.comment', {id: ID, issue: ID, md: 'hi'})).toBe(
			true,
		);
		expect(
			accepts('add.issue.attachment', {
				id: ID,
				issue: ID,
				hash: 'a'.repeat(64),
				ext: 'png',
				name: 'shot.png',
				bytes: 12,
			}),
		).toBe(true);
	});

	it('accepts an attachment extension this build has never seen', () => {
		// Narrowing this to an enum would quarantine a format a later version
		// added. The blob resolver already refuses to serve one it cannot verify.
		expect(
			accepts('add.issue.attachment', {
				id: ID,
				issue: ID,
				author: ID,
				hash: 'a'.repeat(64),
				ext: 'avif',
				name: 'shot.avif',
				bytes: 12,
			}),
		).toBe(true);
	});

	describe('refuses what a handler would fall over', () => {
		it('a rank that is not a string', () => {
			expect(
				accepts('add.issue', {id: ID, name: 'x', parent: ID, rank: 42}),
			).toBe(false);
		});

		it('a missing rank', () => {
			expect(accepts('add.issue', {id: ID, name: 'x', parent: ID})).toBe(false);
		});

		it('an id that is not a string', () => {
			expect(
				accepts('add.issue', {id: 7, name: 'x', parent: ID, rank: RANK}),
			).toBe(false);
		});

		it('an empty id', () => {
			expect(
				accepts('add.issue', {id: '', name: 'x', parent: ID, rank: RANK}),
			).toBe(false);
		});

		it('rebalance ranks that are not an object', () => {
			expect(accepts('rebalance.children', {parent: ID, ranks: null})).toBe(
				false,
			);
		});

		it('rebalance ranks whose values are not ranks', () => {
			expect(
				accepts('rebalance.children', {parent: ID, ranks: {[ID]: 3}}),
			).toBe(false);
		});

		it('a title that is not a string', () => {
			expect(accepts('edit.title', {id: ID, name: {nested: true}})).toBe(false);
		});

		it('a description that is not a string', () => {
			expect(accepts('edit.description', {id: ID, md: null})).toBe(false);
		});

		it('a payload that is not an object at all', () => {
			expect(accepts('lock.node', 'nope')).toBe(false);
			expect(accepts('lock.node', null)).toBe(false);
		});
	});
});
