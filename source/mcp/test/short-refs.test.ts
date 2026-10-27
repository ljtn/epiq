import {describe, expect, it, vi} from 'vitest';
import {isFail, succeeded} from '../../lib/model/result-types.js';
import {expandRefs, hasRefInput, shortenIds} from '../short-refs.js';

const ISSUE = '01KS22YK95S3336MFSE44MY70Q';
const LANE = '01KS22YK95S3336MFSE44MY70R';
const TAG = '01M5X5CDK0733DPKZ8QXV4S20R';
const CONTRIBUTOR = 'AG4F85NT5WDQ4Q7G8W487JAGHH';
// Two ids sharing one random tail: never guessed between.
const TWIN_A = '01M0000000000000000ZZZZZZZ';
const TWIN_B = '01M1111111111111111ZZZZZZZ';

vi.mock('../../lib/state/state.js', () => ({
	getSafeState: () =>
		succeeded('Retrieved state', {
			nodes: {[ISSUE]: {}, [LANE]: {}, [TWIN_A]: {}},
			contributors: {[CONTRIBUTOR]: {}},
			tags: {[TAG]: {}},
			goals: {[TWIN_B]: {}},
			comments: {},
			attachments: {},
		}),
}));

describe('expandRefs', () => {
	it('turns every ref in an id field into its full id', () => {
		const result = expandRefs({
			issueIds: ['MY70Q', '44my70q', ISSUE],
			parentId: '44my70r',
			position: {at: 'before', sibling: '44MY70Q'},
			tagId: 'XV4S20R',
			assigneeId: '87JAGHH',
			title: '44MY70Q',
		});

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value).toEqual({
			issueIds: ['MY70Q', ISSUE, ISSUE],
			parentId: LANE,
			position: {at: 'before', sibling: ISSUE},
			tagId: TAG,
			assigneeId: CONTRIBUTOR,
			title: '44MY70Q',
		});
	});

	it('passes a ref nothing matches through, for the tool to report', () => {
		const result = expandRefs({issueId: 'NOTHERE'});

		expect(isFail(result)).toBe(false);
		expect(result.value).toEqual({issueId: 'NOTHERE'});
	});

	it('fails on a ref two ids share, naming both', () => {
		const result = expandRefs({issueIds: ['ZZZZZZZ']});

		expect(isFail(result)).toBe(true);
		expect(result.message).toContain(TWIN_A);
		expect(result.message).toContain(TWIN_B);
	});

	// `goal` takes a name or an id, so only a goal's ref resolves there.
	it('resolves a goal by its ref, and leaves a name alone', () => {
		expect(expandRefs({goal: 'zzzzzzz'}).value).toEqual({goal: TWIN_B});
		expect(expandRefs({goal: '44MY70Q'}).value).toEqual({goal: '44MY70Q'});
		expect(expandRefs({goal: 'Release'}).value).toEqual({goal: 'Release'});
	});
});

describe('hasRefInput', () => {
	it('sees a ref only in an id field', () => {
		expect(hasRefInput({issueId: '44MY70Q'})).toBe(true);
		expect(hasRefInput({position: {sibling: '44MY70Q'}})).toBe(true);
		expect(hasRefInput({issueIds: [ISSUE, '44MY70Q']})).toBe(true);
		expect(hasRefInput({issueId: ISSUE, title: '44MY70Q'})).toBe(false);
	});
});

describe('shortenIds', () => {
	it('names every known id by its ref, keys included', () => {
		expect(
			shortenIds({
				id: ISSUE,
				ref: '44MY70Q',
				parentNodeId: LANE,
				tags: [{id: TAG, name: 'chore'}],
				byId: {[CONTRIBUTOR]: 1},
				title: ISSUE.toLowerCase(),
			}),
		).toEqual({
			id: '44MY70Q',
			parentNodeId: '44MY70R',
			tags: [{id: 'XV4S20R', name: 'chore'}],
			byId: {'87JAGHH': 1},
			title: ISSUE.toLowerCase(),
		});
	});

	it('keeps an id whole when its ref is shared, and an unknown one', () => {
		const unknown = '01M9999999999999999QQQQQQQ';

		expect(shortenIds([TWIN_A, TWIN_B, unknown])).toEqual([
			TWIN_A,
			TWIN_B,
			unknown,
		]);
	});
});
