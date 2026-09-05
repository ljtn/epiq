import {loadSettingsFromConfig} from '../../lib/config/user-config.js';
import {ulidTimeMs} from '../../lib/event/date-utils.js';
import {CLOSED_SWIMLANE_ID} from '../../lib/event/static-ids.js';
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
import {getStringColor} from '../../lib/utils/color.js';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {sanitizeInlineText} from '../../lib/utils/string.utils.js';
import {getAttachmentFileName} from '../../lib/media/media-store.js';
import {logger} from '../../logger.js';
import {ApiState, ApiSwimlane} from '../api-state.model.js';
import {getTimeTravelStatus} from '../epiq-time-travel.js';
import {
	ToolInput,
	boot,
	getStateResult,
	resolveRepoRoot,
	getActor,
} from './boot.js';
import {getIssueTags, getIssueAssignees} from './issue-helpers.js';
import {getAttachmentMaxKb} from './attachments.js';
import {syncEpiqWithRemote} from '../../git/sync.js';
import {getPersistFileName} from '../../lib/event/event-persist.js';
import {
	setSynced,
	setSyncFailed,
	setSyncing,
} from '../../lib/state/sync-state.js';

export const getEpiqState = async (input: ToolInput = {}) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
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

// How far back the closed lane is sent. It is the one collection that grows
// without bound — everything a team finishes lands there and stays — so a
// decade of a twenty-person board is ninety-five thousand closed tickets
// against a couple of hundred open ones.
//
// A year is what a reader is plausibly still looking for by eye. Reaching
// further back is a request of its own rather than a cost every board pays on
// every load.
const CLOSED_TICKET_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

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
			// Everything a team ever finished lands in the closed lane and stays,
			// so it is the one collection with no ceiling: a decade of a
			// twenty-person board is ninety-five thousand tickets against a
			// couple of hundred open ones, and sending them all is most of an
			// 88 MB payload the browser has to parse before it can draw.
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

	// The tickets the payload actually carries. Comments and attachments are
	// built for these rather than for every ticket that has ever existed: a
	// closed ticket nobody is sent does not need its conversation sent either.
	const sentIssueIds = new Set<string>();

	for (const tickets of ticketsBySwimlaneId.values()) {
		for (const ticket of tickets) sentIssueIds.add(ticket.id);
	}

	const settingsRes = loadSettingsFromConfig();
	if (isFail(settingsRes)) return settingsRes;

	const commentsByIssueId: ApiState['commentsByIssueId'] = {};

	// Grouped once rather than asked for per issue: asking per issue reads every
	// comment on the board each time, which on a board with a hundred thousand
	// of each never finishes.
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
					author: {
						id: comment.authorId,
						name: contributor?.name ?? 'Unknown',
						// The author is optional in the log by design — the payload
						// schema leaves it unconstrained so an event already written
						// without one is not thrown away. So it can be missing here,
						// and a colour is not worth taking the whole board down for.
						color: getStringColor(
							contributor?.name ?? comment.authorId ?? 'Unknown',
						),
					},
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
										readonly: Boolean(issue.readonly) || forceReadonly,
										tags: getIssueTags(issue),
										assignees: getIssueAssignees(issue),
										parentNodeId: issue.parentNodeId!,
										isClosed: issue.parentNodeId === CLOSED_SWIMLANE_ID,
									})),
								parentNodeId: swimlane.parentNodeId!,
							} satisfies ApiSwimlane),
					),
			})),
		tags: nodeRepo.getTags().map(x => ({
			...x,
			color: getStringColor(x.name),
		})),
		contributors: Object.values(stateResult.value.contributors).map(x => ({
			...x,
			color: getStringColor(x.name),
		})),
		user: {
			name: settingsRes.value.userName ?? '',
			id: settingsRes.value.userId ?? '',
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
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	rememberOpenedProject(bootResult.value.repoRoot);

	return deriveGuiState();
};

type SyncInput = ToolInput;

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
