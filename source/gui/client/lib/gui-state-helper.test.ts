import {describe, expect, it} from 'vitest';
import {findBoard, findIssue} from './gui-state-helper';
import {GuiIssue, GuiState} from './gui-state.model';

const issue = (id: string, ref: string, title: string): GuiIssue => ({
	id,
	ref,
	title,
	description: '',
	readonly: false,
	isClosed: false,
	tags: [],
	assignees: [],
});

// Two issues deliberately share the ref AAAAAAA to simulate a collision.
const state: GuiState = {
	boards: [
		{
			id: '01KS22YK9AXCMATZXTR5JZCS5M',
			ref: '5JZCS5M',
			title: 'Default',
			swimlanes: [
				{
					id: 'lane-1',
					title: 'Todo',
					readonly: false,
					issues: [
						issue('01AAAAAAAAAAAAAAAAAAAAAAAA', 'AAAAAAA', 'First clash'),
						issue('01BBBBBBBBBBBBBBBBBAAAAAAA', 'AAAAAAA', 'Second clash'),
						issue('01KS22YK9AXCMATZXTRRUNIQ01', 'RUNIQ01', 'Unique'),
					],
				},
			],
		},
		{
			id: '00JR3R8E00A1Z4X9FGP9DV0SM5',
			ref: '9DV0SM5',
			title: 'Closed',
			swimlanes: [],
		},
	],
	tags: [],
	contributors: [],
	user: {id: 'u', name: 'u', color: ''},
	commentsByIssueId: {},
};

describe('GUI ref resolution', () => {
	it('resolves a unique ref, tolerating hyphen and case', () => {
		expect(findIssue(state, 'RUNIQ01')?.title).toBe('Unique');
		expect(findIssue(state, 'run-iq01')?.title).toBe('Unique');
		expect(findBoard(state, '9DV0SM5')?.title).toBe('Closed');
	});

	it('resolves a full id even when its ref collides', () => {
		expect(findIssue(state, '01AAAAAAAAAAAAAAAAAAAAAAAA')?.title).toBe(
			'First clash',
		);
	});

	it('refuses to guess on an ambiguous ref', () => {
		expect(findIssue(state, 'AAAAAAA')).toBeNull();
	});

	it('returns null for an unknown ref', () => {
		expect(findIssue(state, 'ZZZZZZZ')).toBeNull();
		expect(findBoard(state, 'ZZZZZZZ')).toBeNull();
	});
});
