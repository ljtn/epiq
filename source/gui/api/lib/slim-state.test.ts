import {describe, expect, it} from 'vitest';
import {ApiState} from '../../../mcp/api-state.model.js';
import {issueDetail, slimStateForBoard} from './slim-state.js';

const state = (): ApiState =>
	({
		boards: [
			{
				id: 'b1',
				swimlanes: [
					{
						id: 's1',
						issues: [
							{id: 'i1', title: 'One', description: 'a long description'},
							{id: 'i2', title: 'Two', description: 'another one'},
						],
					},
				],
			},
		],
		commentsByIssueId: {
			i1: [{id: 'c1', issueId: 'i1', body: 'a long body', author: {id: 'u1'}}],
			i2: [],
		},
		attachmentsByIssueId: {i1: [], i2: []},
	} as unknown as ApiState);

describe('slimStateForBoard', () => {
	it('drops the text the board never draws', () => {
		const slim = slimStateForBoard(state());
		const issues = slim.boards[0]!.swimlanes[0]!.issues;

		expect(issues.map(i => i.description)).toEqual(['', '']);
		expect(slim.commentsByIssueId['i1']![0]!.body).toBe('');
	});

	it('keeps what the card and the filter still need', () => {
		const slim = slimStateForBoard(state());

		// The count on the card, and the author the scrubber filters by.
		expect(slim.commentsByIssueId['i1']).toHaveLength(1);
		expect(slim.commentsByIssueId['i1']![0]!.author.id).toBe('u1');
		expect(slim.boards[0]!.swimlanes[0]!.issues[0]!.title).toBe('One');
	});

	it('omits empty entries rather than shipping empty arrays', () => {
		const slim = slimStateForBoard(state());

		expect('i2' in slim.commentsByIssueId).toBe(false);
		expect(slim.attachmentsByIssueId).toEqual({});
	});

	it('survives a state missing its collections', () => {
		// This sits on the broadcast path; a malformed state must not silence it.
		expect(() => slimStateForBoard({} as ApiState)).not.toThrow();
	});
});

describe('issueDetail', () => {
	it('returns the description and comments the slimmed state left out', () => {
		expect(issueDetail(state(), 'i1')).toEqual({
			issueId: 'i1',
			description: 'a long description',
			comments: state().commentsByIssueId['i1'],
		});
	});

	it('is empty for an issue that is not there', () => {
		expect(issueDetail(state(), 'nope')).toEqual({
			issueId: 'nope',
			description: '',
			comments: [],
		});
	});
});
