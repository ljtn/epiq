import {loadSettingsFromConfig} from '../../lib/config/user-config.js';
import {ulidTimeMs} from '../../lib/event/date-utils.js';
import {CLOSED_SWIMLANE_ID} from '../../lib/board/static-ids.js';
import {
	isBoardNode,
	isSwimlaneNode,
	isTicketNode,
	Swimlane,
	Ticket,
} from '../../lib/model/context.model.js';
import {
	isFail,
	Result,
	succeeded,
	failed,
} from '../../lib/model/result-types.js';
import {nodeRepo} from '../../lib/repository/node-repo.js';
import {recordRecentProject} from '../../lib/config/recent-projects.js';
import {identityOf} from '../../lib/model/identity.js';
import {getStringColor} from '../../lib/utils/color.js';
import {laneEntryTime, lastEventTime} from '../../lib/utils/lane-dwell.js';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {sanitizeInlineText} from '../../lib/utils/string.utils.js';
import {getAttachmentFileName} from '../../lib/media/media-store.js';
import {logger} from '../../logger.js';
import {ApiState, ApiSwimlane} from '../api-state.model.js';
import {descriptionOf} from './descriptions.js';
import {getTimeTravelStatus} from '../epiq-time-travel.js';
import {
	ToolInput,
	bootLocal,
	getActor,
	getStateResult,
	resolveRepoRoot,
} from './boot.js';
import {getIssueTags, getIssueAssignees} from './issue-projection.js';
import {boardsEverOnOf} from '../../lib/utils/ticket-boards.js';
import {apiBoardGoals, apiGoals, goalFields} from './goals.js';
import {rulesOf} from './lane-rules.js';
import {isDoneLane, isNamedDone} from '../../lib/utils/lane-rules.js';
import {getAttachmentMaxKb} from './attachments.js';
import {syncEpiqWithRemote} from '../../git/sync.js';
import {getPersistFileName} from '../../lib/board/board-log.js';
import {
	setSynced,
	setSyncFailed,
	setSyncing,
} from '../../lib/state/sync-state.js';

export const getEpiqState = async (input: ToolInput = {}) => {
	const bootResult = await bootLocal(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	return succeeded('Retrieved Epiq state', {
		root: bootResult.value.repoRoot,
		stateBranchRoot: bootResult.value.stateBranchRoot,
		nodes: stateResult.value.nodes,
		rootNodeId: stateResult.value.rootNodeId,
		contextNode: stateResult.value.contextNode,
		selectedIndex: stateResult.value.selectedIndex,
		eventLog: stateResult.value.eventLog,
	});
};

// How far back the closed lane is sent: the one collection that grows without bound.
const CLOSED_TICKET_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * One ticket's description, off the node rather than `deriveGuiState`: hover
 * previews ask on every mouseover. Missing or deleted reads as empty.
 */
export const getIssueDescription = (issueId: string): Result<string> => {
	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const node = stateResult.value.nodes[issueId];

	return succeeded(
		'Issue description',
		node && isTicketNode(node) && !node.isDeleted
			? node.props.description ?? ''
			: '',
	);
};

// Reads whatever is currently materialized, live or a historical checkout. Must
// never boot: booting discards an active time-travel checkout.
export const deriveGuiState = (): Result<ApiState> => {
	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const timeTravel = getTimeTravelStatus();
	const forceReadonly = timeTravel.mode !== 'live';

	const nodes = Object.values(stateResult.value.nodes);
	const boards = nodes.filter(n => isBoardNode(n) && !n.isDeleted);

	const closedSince = Date.now() - CLOSED_TICKET_WINDOW_MS;

	const swimlanesByBoardId = new Map<string, Swimlane[]>();
	const ticketsBySwimlaneId = new Map<string, Ticket[]>();

	for (const node of nodes) {
		if (node.isDeleted) continue;

		if (isSwimlaneNode(node) && node.parentNodeId) {
			const list = swimlanesByBoardId.get(node.parentNodeId) ?? [];
			list.push(node);
			swimlanesByBoardId.set(node.parentNodeId, list);
		}

		if (isTicketNode(node) && node.parentNodeId) {
			// The closed lane is windowed; it would be most of the payload.
			if (
				node.parentNodeId === CLOSED_SWIMLANE_ID &&
				ulidTimeMs(node.id) < closedSince
			) {
				continue;
			}

			const list = ticketsBySwimlaneId.get(node.parentNodeId) ?? [];
			list.push(node);
			ticketsBySwimlaneId.set(node.parentNodeId, list);
		}
	}

	// Comments and attachments are built only for the tickets sent.
	const sentIssueIds = new Set<string>();

	for (const tickets of ticketsBySwimlaneId.values()) {
		for (const ticket of tickets) sentIssueIds.add(ticket.id);
	}

	const settingsRes = loadSettingsFromConfig();
	if (isFail(settingsRes)) return settingsRes;

	const commentsByIssueId: ApiState['commentsByIssueId'] = {};

	// Grouped once: per-issue lookups each read every comment.
	const commentsByIssue = nodeRepo.getCommentsGroupedByIssue();

	for (const issue of nodes.filter(isTicketNode)) {
		if (issue.isDeleted || !sentIssueIds.has(issue.id)) continue;

		commentsByIssueId[issue.id] = (commentsByIssue.get(issue.id) ?? []).map(
			comment => {
				const contributor = nodeRepo.getContributor(comment.authorId);

				return {
					id: comment.id,
					issueId: comment.issue,
					body: comment.md,
					// The author is optional in the log; `identityOf` decides how a missing one shows.
					author: identityOf(comment.authorId, contributor?.name),
					createdAt: ulidTimeMs(comment.id),
				};
			},
		);
	}

	const attachmentOwners = new Map<string, string>();
	for (const event of stateResult.value.eventLog) {
		if (event.action === 'add.issue.attachment') {
			attachmentOwners.set(event.payload.id, event.payload.author);
		}
	}

	const attachmentsByIssueId: ApiState['attachmentsByIssueId'] = {};

	const attachmentsByIssue = nodeRepo.getAttachmentsGroupedByIssue();

	for (const issue of nodes.filter(isTicketNode)) {
		if (issue.isDeleted || !sentIssueIds.has(issue.id)) continue;

		attachmentsByIssueId[issue.id] = (
			attachmentsByIssue.get(issue.id) ?? []
		).map(attachment => ({
			id: attachment.id,
			issueId: attachment.issue,
			name: attachment.name,
			fileName: getAttachmentFileName(attachment.hash, attachment.ext),
			bytes: attachment.bytes,
			createdAt: ulidTimeMs(attachment.id),
			canDelete:
				attachmentOwners.get(attachment.id) === settingsRes.value.userId,
		}));
	}

	return succeeded('Retrieved Epiq GUI state', {
		boards: boards
			.sort((a, b) => a.rank.localeCompare(b.rank))
			.map(b => ({
				id: b.id,
				ref: nodeRef(b.id),
				title: b.title,
				readonly: Boolean(b.readonly) || forceReadonly,
				...descriptionOf(b.id),
				goals: apiBoardGoals(b.id),
				swimlanes: (swimlanesByBoardId.get(b.id) ?? [])
					.sort((a, b) => a.rank.localeCompare(b.rank))
					.map(
						swimlane =>
							({
								id: swimlane.id,
								title: swimlane.title,
								readonly: Boolean(swimlane.readonly) || forceReadonly,
								issues: (ticketsBySwimlaneId.get(swimlane.id) ?? [])
									.sort((a, b) => a.rank.localeCompare(b.rank))
									.map(issue => ({
										id: issue.id,
										ref: nodeRef(issue.id),
										title: sanitizeInlineText(issue.title),
										description: issue.props.description ?? '',
										createdAt: ulidTimeMs(issue.id),
										enteredLaneAt: laneEntryTime(
											issue.log ?? [],
											ulidTimeMs(issue.id),
										),
										lastEventAt: lastEventTime(
											issue.log ?? [],
											ulidTimeMs(issue.id),
										),
										readonly: Boolean(issue.readonly) || forceReadonly,
										tags: getIssueTags(issue),
										assignees: getIssueAssignees(issue),
										...goalFields(issue),
										parentNodeId: issue.parentNodeId!,
										isClosed: issue.parentNodeId === CLOSED_SWIMLANE_ID,
										boardIds: boardsEverOnOf(issue),
									})),
								parentNodeId: swimlane.parentNodeId!,
								...descriptionOf(swimlane.id),
								...rulesOf(swimlane),
								countsDone: isDoneLane(swimlane.id),
								doneByName: isNamedDone(swimlane),
							} satisfies ApiSwimlane),
					),
			})),
		tags: nodeRepo.getTags().map(x => ({...x, ...identityOf(x.id, x.name)})),
		goals: apiGoals(),
		contributors: Object.values(stateResult.value.contributors).map(x => ({
			...x,
			...identityOf(x.id, x.name),
		})),
		// Not `identityOf`: the config's name, drawn blank when unset.
		user: {
			id: settingsRes.value.userId ?? '',
			name: settingsRes.value.userName ?? '',
			color: getStringColor(settingsRes.value.userName ?? ''),
		},
		commentsByIssueId,
		attachmentsByIssueId,
		attachmentMaxKb: getAttachmentMaxKb(),
		timeTravel,
	} satisfies ApiState);
};

// The GUI asks for state after every mutation; the registry only needs to hear
// about a project once per session.
let lastRememberedRoot: string | null = null;

const rememberOpenedProject = (repoRoot: string): void => {
	if (repoRoot === lastRememberedRoot) return;

	const result = recordRecentProject({root: repoRoot});
	if (isFail(result)) {
		logger.info(result.message);
		return;
	}

	lastRememberedRoot = repoRoot;
};

export const getGuiState = async (
	input: ToolInput = {},
): Promise<Result<ApiState>> => {
	// Fast path; the guarantee that a checkout survives a boot lives in
	// `bootStateFromEventLog`, not here.
	if (getTimeTravelStatus().mode !== 'live') {
		return deriveGuiState();
	}

	// Never pull on a read: it would hang sandboxed or offline setups. Freshness
	// is an explicit periodic sync's job.
	const bootResult = await bootLocal(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	rememberOpenedProject(bootResult.value.repoRoot);

	return deriveGuiState();
};

type SyncInput = ToolInput;

// The board only, under its lock; `syncThenFetchRepos` fetches the other repos after.
export const sync = async (input: SyncInput = {}) => {
	setSyncing();
	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed('Sync failed');

	const actor = getActor();
	if (isFail(actor)) return actor;

	const result = await syncEpiqWithRemote({
		cwd: repoRootResult.value,
		ownEventFileName: getPersistFileName(actor.value),
	});

	if (isFail(result)) {
		setSyncFailed(result.message);
		return result;
	}

	setSynced();
	return succeeded('Synced', result.value);
};
