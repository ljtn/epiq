import {ulid} from 'ulid';
import {navigationUtils} from '../../actions/default/navigation-action-utils.js';
import {createIssueEvents} from '../../event/common-events.js';
import {
	materializeAndPersist,
	materializeAndPersistAll,
} from '../../event/event-materialize-and-persist.js';
import {resolveActorId} from '../../event/event-persist.js';
import {AppEvent} from '../../event/event.model.js';
import {CommandLineActionEntry} from '../../model/action-map.model.js';
import {findInBreadCrumb} from '../../model/app-state.model.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {nodeRepo} from '../../repository/node-repo.js';
import {resolveAndPersistRankForCreate} from '../../repository/rank.js';
import {getRenderedChildren, getState} from '../../state/state.js';
import {getPersistRoot} from '../../storage/paths.js';

export const newCommand: CommandLineActionEntry['action'] = async (
	_cmdAction,
	cmdState,
) => {
	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	const persistRootResult = await getPersistRoot();
	if (isFail(persistRootResult)) return persistRootResult;

	const persistRoot = persistRootResult.value;

	if (!cmdState.inputString) {
		return failed(`provide a name for your ${cmdState.modifier}`);
	}

	const {breadCrumb, contextNode, selectedIndex} = getState();

	const createAndNavigate = (
		event: AppEvent<
			'add.workspace' | 'add.board' | 'add.swimlane' | 'add.issue' | 'add.field'
		>,
	) => {
		const result = materializeAndPersist(event, persistRoot);
		if (isFail(result)) return result;

		const createdNode = nodeRepo.getNode(result.value.result.id);
		if (!createdNode) return failed('Created node not found');

		if (!createdNode.parentNodeId) return result;

		const parentNode = nodeRepo.getNode(createdNode.parentNodeId);
		if (!parentNode) return failed('Parent node not found');

		navigationUtils.navigate({
			contextNode: parentNode,
			selectedIndex: nodeRepo
				.getSiblings(createdNode.parentNodeId)
				.findIndex(({id}) => id === createdNode.id),
		});

		return result;
	};

	if (cmdState.modifier === 'board') {
		const {rootNodeId} = getState();
		const workspace = nodeRepo.getNode<'WORKSPACE'>(rootNodeId);
		if (!workspace) return failed('Workspace not found');

		const rankResult = resolveAndPersistRankForCreate(
			workspace.id,
			userRes.value,
			persistRoot,
		);
		if (isFail(rankResult)) return rankResult;

		return createAndNavigate({
			id: ulid(),
			action: 'add.board',
			payload: {
				id: ulid(),
				name: cmdState.inputString,
				parent: workspace.id,
				rank: rankResult.value,
			},
			...userRes.value,
		});
	}

	if (cmdState.modifier === 'swimlane') {
		const boardResult = findInBreadCrumb(breadCrumb, 'BOARD');
		if (isFail(boardResult)) {
			return failed('Unable to add swimlane in this context');
		}

		const rankResult = resolveAndPersistRankForCreate(
			boardResult.value.id,
			userRes.value,
			persistRoot,
		);
		if (isFail(rankResult)) return rankResult;

		return createAndNavigate({
			id: ulid(),
			action: 'add.swimlane',
			payload: {
				id: ulid(),
				name: cmdState.inputString,
				parent: boardResult.value.id,
				rank: rankResult.value,
			},
			...userRes.value,
		});
	}

	if (cmdState.modifier === 'issue') {
		const selectedNode = getRenderedChildren(contextNode.id)[selectedIndex];
		const swimlane =
			contextNode.context === 'SWIMLANE'
				? contextNode
				: contextNode.context === 'BOARD' &&
				  selectedNode?.context === 'SWIMLANE'
				? selectedNode
				: (() => {
						const swimlaneResult = findInBreadCrumb(breadCrumb, 'SWIMLANE');
						return isFail(swimlaneResult) ? null : swimlaneResult.value;
				  })();

		if (!swimlane) {
			return failed('Unable to add issue in this context');
		}

		const rankResult = resolveAndPersistRankForCreate(
			swimlane.id,
			userRes.value,
			persistRoot,
		);
		if (isFail(rankResult)) return rankResult;

		const issueEventsResult = createIssueEvents({
			name: cmdState.inputString,
			parent: swimlane.id,
			rank: rankResult.value,
			user: userRes.value,
		});
		if (isFail(issueEventsResult)) return issueEventsResult;

		const issueEvents = issueEventsResult.value;
		const issueResults = materializeAndPersistAll(issueEvents, persistRoot);

		if (issueResults.some(x => isFail(x))) {
			return failed(
				'Issue create failed: ' +
					issueResults
						.filter(isFail)
						.map(r => r.message)
						.filter(Boolean)
						.join(', '),
			);
		}

		const issueResult = issueResults[0];
		if (!issueResult || isFail(issueResult)) {
			return failed('Issue creation failed');
		}

		const issueEvent = issueEvents.find(
			(event): event is AppEvent<'add.issue'> => event.action === 'add.issue',
		);

		const ticketId = issueEvent?.payload.id;
		if (!ticketId) return failed('Unable to determine ticket id');

		navigationUtils.navigate({
			contextNode: swimlane,
			selectedIndex: nodeRepo
				.getSiblings(swimlane.id)
				.findIndex(({id}) => id === ticketId),
		});

		return succeeded('Issue created', null);
	}

	return succeeded('Success', null);
};
