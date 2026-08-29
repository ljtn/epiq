import {describe, expect, it} from 'vitest';
import {parseGuiMessage} from '../gui/api/lib/websocket.schema.js';

const issueId = '01H0000000000000000000000A';

describe('parseGuiMessage', () => {
	it('accepts a well-formed message', () => {
		const parsed = parseGuiMessage({type: 'issue:close', payload: {issueId}});

		expect(parsed).toEqual({
			ok: true,
			message: {type: 'issue:close', payload: {issueId}},
		});
	});

	it('accepts a message whose payload is optional', () => {
		expect(parseGuiMessage({type: 'state:get'}).ok).toBe(true);
		expect(parseGuiMessage({type: 'timeline:get'}).ok).toBe(true);
	});

	// Handlers spread the payload into the API call, and the spread wins — so an
	// unknown `repoRoot` key pointed the server at a different project on the
	// machine.
	it('drops keys the message does not declare', () => {
		const parsed = parseGuiMessage({
			type: 'issue:comment:add',
			payload: {issueId, body: 'hi', repoRoot: '/somewhere/else'},
		});

		expect(parsed.ok).toBe(true);
		if (!parsed.ok || parsed.message.type !== 'issue:comment:add') {
			throw new Error('expected an issue:comment:add message');
		}

		expect(parsed.message.payload).toEqual({issueId, body: 'hi'});
	});

	// A ticket filed from a code selection sends both; undeclared, they were
	// silently stripped and the ticket arrived bare.
	it('keeps the description and tags of a created issue', () => {
		const payload = {
			title: 'Follow-up',
			parentId: issueId,
			description: 'why',
			tagNames: ['from-code-comment'],
		};
		const parsed = parseGuiMessage({type: 'issues:create', payload});

		expect(parsed.ok).toBe(true);
		if (!parsed.ok || parsed.message.type !== 'issues:create') {
			throw new Error('expected an issues:create message');
		}

		expect(parsed.message.payload).toEqual(payload);
	});

	it('accepts a comment edit', () => {
		const payload = {issueId, commentId: issueId, body: 'again'};
		const parsed = parseGuiMessage({type: 'issue:comment:edit', payload});

		expect(parsed.ok).toBe(true);
		if (!parsed.ok || parsed.message.type !== 'issue:comment:edit') {
			throw new Error('expected an issue:comment:edit message');
		}

		expect(parsed.message.payload).toEqual(payload);
	});

	it.each([
		['null', null],
		['a number', 123],
		['a string', 'issue:close'],
		['an unknown type', {type: 'rm -rf'}],
		['a missing payload', {type: 'issue:close'}],
		['a missing field', {type: 'issue:comment:add', payload: {issueId}}],
		[
			'a wrong-typed field',
			{type: 'issue:edit:title', payload: {issueId, title: 42}},
		],
		['an empty id', {type: 'issue:close', payload: {issueId: ''}}],
		[
			'a non-finite time',
			{type: 'time-travel:scrub', payload: {targetTime: Infinity}},
		],
		[
			'NaN as a time',
			{type: 'time-travel:scrub', payload: {targetTime: Number.NaN}},
		],
		[
			'an unknown move position',
			{
				type: 'issues:move',
				payload: {issueId, parentId: issueId, position: {at: 'middle'}},
			},
		],
	])('refuses %s', (_label, raw) => {
		const parsed = parseGuiMessage(raw);

		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.error).toMatch(/^Invalid message: /);
	});
});
