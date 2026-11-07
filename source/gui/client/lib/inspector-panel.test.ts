import {describe, expect, it} from 'vitest';
import {InspectorSubjects, inspectorPanel} from './inspector-panel';

const nothing: InspectorSubjects = {
	playing: false,
	commitDiff: false,
	lane: false,
	boardDetails: false,
	boardOnScreen: true,
	goal: false,
	pickedCount: 0,
	issue: false,
};

const everything: InspectorSubjects = {
	playing: true,
	commitDiff: true,
	lane: true,
	boardDetails: true,
	boardOnScreen: true,
	goal: true,
	pickedCount: 2,
	issue: true,
};

describe('inspectorPanel', () => {
	it('shows nothing with nothing open', () => {
		expect(inspectorPanel(nothing)).toBe('none');
	});

	it('shows the first open subject, film, diff, lane, board, goal, bulk, ticket', () => {
		const order: [keyof InspectorSubjects, string][] = [
			['playing', 'none'],
			['commitDiff', 'diff'],
			['lane', 'lane'],
			['boardDetails', 'board'],
			['goal', 'goal'],
			['pickedCount', 'bulk'],
			['issue', 'issue'],
		];
		let open = {...everything};
		for (const [subject, panel] of order) {
			expect(inspectorPanel(open)).toBe(panel);
			open = {...open, [subject]: subject === 'pickedCount' ? 1 : false};
		}
		expect(inspectorPanel(open)).toBe('none');
	});

	it('shows a ticket, not the bulk panel, for a single pick', () => {
		expect(inspectorPanel({...nothing, pickedCount: 1, issue: true})).toBe(
			'issue',
		);
	});

	it("holds the board panel's place with no board on screen", () => {
		expect(
			inspectorPanel({
				...nothing,
				boardDetails: true,
				boardOnScreen: false,
				goal: true,
				issue: true,
			}),
		).toBe('none');
	});
});
