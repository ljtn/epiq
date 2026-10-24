import {describe, expect, it} from 'vitest';
import {createDefaultEvents} from '../lib/board/board-boot.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {
	materializeAll,
	materializeAndPersistAll,
} from '../lib/board/board-log.js';
import {getStateBranchRoot} from '../git/git-storage.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {
	assumeActor,
	createIssue,
	listBoards,
	listSwimlanes,
	setIssueColor,
	setIssueFeature,
} from '../mcp/epiq-api.js';
import {deriveGuiState} from '../mcp/api/state.js';
import {nodeRepo} from '../lib/repository/node-repo.js';
import {featureMark} from '../lib/utils/feature.utils.js';
import {Ticket} from '../lib/model/context.model.js';
import {setupRepo, useTempHome} from './helpers/git-repo.js';

useTempHome();

const unwrap = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const seed = async () => {
	const {repoRoot} = await setupRepo();
	const assumed = unwrap(await assumeActor({repoRoot, name: 'claude/peter'}));
	const branchRoot = unwrap(getStateBranchRoot({repoRoot}));
	unwrap(
		materializeAndPersistAll(
			[...unwrap(createDefaultEvents(assumed))] as AppEvent[],
			branchRoot,
		),
	);

	const home = unwrap(await listBoards({repoRoot})).find(b => !b.readonly)!;
	const lane = unwrap(await listSwimlanes({repoRoot, boardId: home.id}))[0]!;
	const file = async (title: string) =>
		unwrap(await createIssue({repoRoot, title, parentId: lane.id})).id;

	const actor = {userId: assumed.userId};

	return {repoRoot, branchRoot, file, actor};
};

const issueOf = (id: string) => {
	const state = unwrap(deriveGuiState());

	return state.boards
		.flatMap(board => board.swimlanes.flatMap(lane => lane.issues))
		.find(candidate => candidate.id === id)!;
};

describe('a ticket in a feature', () => {
	it('carries the feature as it reads now, and leaves it again', async () => {
		const {repoRoot, file} = await seed();
		const epic = await file('Time travel');
		const part = await file('Needle in the URL');

		unwrap(await setIssueFeature({repoRoot, issueId: part, feature: epic}));

		const feature = issueOf(part).feature!;
		expect(feature.id).toBe(epic);
		expect(feature.title).toBe('Time travel');
		expect(feature.color).toMatch(/^#[0-9a-f]{6}$/i);
		expect(issueOf(epic).feature).toBeUndefined();

		unwrap(await setIssueColor({repoRoot, issueId: epic, color: '#AA3300'}));
		expect(issueOf(part).feature!.color).toBe('#aa3300');
		expect(issueOf(epic).color).toBe('#aa3300');

		unwrap(await setIssueFeature({repoRoot, issueId: part, feature: null}));
		expect(issueOf(part).feature).toBeUndefined();
		expect(Object.keys(issueOf(part))).not.toContain('feature');
	});

	it('takes the feature by ref, as an agent names it', async () => {
		const {repoRoot, file} = await seed();
		const epic = await file('Linked repos');
		const part = await file('Shallow clone');
		const ref = issueOf(epic).ref;

		unwrap(await setIssueFeature({repoRoot, issueId: part, feature: ref}));
		expect(issueOf(part).feature!.id).toBe(epic);
	});

	it('stays one level deep', async () => {
		const {repoRoot, file} = await seed();
		const epic = await file('Epic');
		const part = await file('Part');
		const other = await file('Other');

		unwrap(await setIssueFeature({repoRoot, issueId: part, feature: epic}));

		const self = await setIssueFeature({
			repoRoot,
			issueId: epic,
			feature: epic,
		});
		expect(isFail(self) && self.message).toMatch(/not its own feature/);

		const intoMember = await setIssueFeature({
			repoRoot,
			issueId: other,
			feature: part,
		});
		expect(isFail(intoMember) && intoMember.message).toMatch(
			/itself in a feature/,
		);

		const featureIntoOne = await setIssueFeature({
			repoRoot,
			issueId: epic,
			feature: other,
		});
		expect(isFail(featureIntoOne) && featureIntoOne.message).toMatch(
			/is a feature/,
		);
	});

	it('refuses a colour it cannot read', async () => {
		const {repoRoot, file} = await seed();
		const epic = await file('Epic');

		const bad = await setIssueColor({repoRoot, issueId: epic, color: 'red'});
		expect(isFail(bad)).toBe(true);
	});

	it('draws no feature once the feature ticket is gone', async () => {
		const {repoRoot, branchRoot, file, actor} = await seed();
		const epic = await file('Short-lived');
		const part = await file('Survivor');

		unwrap(await setIssueFeature({repoRoot, issueId: part, feature: epic}));
		unwrap(
			materializeAndPersistAll(
				[
					{
						id: '01M5Z00000000000000000000C',
						...actor,
						action: 'delete.node',
						payload: {id: epic},
					},
				] as AppEvent[],
				branchRoot,
			),
		);

		expect(issueOf(part).feature).toBeUndefined();
		expect(featureMark(nodeRepo.getNode(part) as Ticket, 20)).toBeNull();
	});
});

describe('the terminal mark on a feature', () => {
	it('counts a member as soon as it joins', async () => {
		const {repoRoot, file} = await seed();
		const epic = await file('Epic');
		const one = await file('One');
		const two = await file('Two');
		const mark = () => featureMark(nodeRepo.getNode(epic) as Ticket, 30)?.text;

		expect(mark()).toBeUndefined();
		unwrap(await setIssueFeature({repoRoot, issueId: one, feature: epic}));
		expect(mark()).toBe('◆ feature (1)');
		unwrap(await setIssueFeature({repoRoot, issueId: two, feature: epic}));
		expect(mark()).toBe('◆ feature (2)');
		unwrap(await setIssueFeature({repoRoot, issueId: one, feature: null}));
		expect(mark()).toBe('◆ feature (1)');
	});
});

describe('a ticket whose feature is gone', () => {
	it('can become a feature itself', async () => {
		const {repoRoot, branchRoot, file, actor} = await seed();
		const gone = await file('Gone');
		const orphan = await file('Orphan');
		const joiner = await file('Joiner');

		unwrap(await setIssueFeature({repoRoot, issueId: orphan, feature: gone}));
		unwrap(
			materializeAndPersistAll(
				[
					{
						id: '01M5Z00000000000000000000D',
						...actor,
						action: 'delete.node',
						payload: {id: gone},
					},
				] as AppEvent[],
				branchRoot,
			),
		);

		unwrap(await setIssueFeature({repoRoot, issueId: joiner, feature: orphan}));
		expect(issueOf(joiner).feature!.id).toBe(orphan);
	});
});

describe('replaying feature events', () => {
	it('skips a ticket named as its own feature, and drops a colour it cannot read', async () => {
		const {file, actor} = await seed();
		const part = await file('Part');

		const [own, color] = materializeAll([
			{
				id: '01M5Z00000000000000000000A',
				...actor,
				action: 'set.issue.feature',
				payload: {id: part, feature: part},
			},
			{
				id: '01M5Z00000000000000000000B',
				...actor,
				action: 'set.issue.color',
				payload: {id: part, color: 'not-a-colour'},
			},
		] as AppEvent[]);

		expect(isFail(own as Result)).toBe(true);
		expect(isFail(color as Result)).toBe(false);
		expect(issueOf(part).feature).toBeUndefined();
		expect(issueOf(part).color).toBeUndefined();
	});
});
