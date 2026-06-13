import chalk from 'chalk';
import stringWidth from 'string-width';
import {decodeTime} from 'ulid';
import {nodeRepo} from '../repository/node-repo.js';
import {getState} from '../state/state.js';
import {getStringColor} from '../utils/color.js';
import {LogEvolutionForEvent} from '../virtual-nodes/virtual-nodes.js';
import {timeAgo} from './date-utils.js';
import {AppEvent, EventAction} from './event.model.js';

const padVisibleEnd = (value: string, width: number): string =>
	value + ' '.repeat(Math.max(0, width - stringWidth(value)));

const padVisibleStart = (value: string, width: number): string =>
	' '.repeat(Math.max(0, width - stringWidth(value))) + value;

const formatLogAction = (action: string): string => {
	const pastTbl: Partial<Record<EventAction, string>> = {
		'add.issue': 'Created with title',
		'add.issue.assignee': 'Assigned to',
		'remove.issue.assignee': 'Unassigned from',
		'close.issue': 'Closed',
		'delete.node': 'Deleted',
		'edit.title': 'Changed title to',
		'edit.description': 'Changed description',
		'reopen.issue': 'Reopened',
		'add.issue.tag': 'Tagged with',
		'remove.issue.tag': 'Removed tag',
		'lock.node': 'Locked node',
		'move.node': 'Moved issue',
		'add.issue.comment': 'Commented',
		'delete.issue.comment': 'Deleted comment',
	};

	return (
		pastTbl[action as EventAction] ??
		(action.endsWith('e') ? `${action}d` : `${action}ed`)
	);
};
const getRankDirection = (
	currentRank: string,
	previousRank: string | undefined,
): 'up' | 'down' | null => {
	if (!previousRank) return null;

	if (currentRank < previousRank) return 'up';
	if (currentRank > previousRank) return 'down';

	return null;
};

const formatMoveLogMain = (
	event: AppEvent<'move.node'>,
	logEvolution: LogEvolutionForEvent<'move.node'>,
): string => {
	const parent = nodeRepo.getNode(event.payload.parent);
	const parentLabel = parent
		? chalk.dim.bgBlack(` ${parent.title} `)
		: 'unknown';

	const previousMove = logEvolution.at(-1);

	if (
		previousMove &&
		'parent' in previousMove &&
		'rank' in previousMove &&
		previousMove.parent === event.payload.parent
	) {
		const direction = getRankDirection(event.payload.rank, previousMove.rank);

		if (direction) {
			return `Moved ${direction} in ${parentLabel}`;
		}
	}

	return `Moved issue to ${parentLabel}`;
};

const formatEventDetails = (event: AppEvent): string => {
	switch (event.action) {
		case 'add.issue.tag': {
			const tag = getState().tags[event.payload.tag];
			return tag
				? chalk.bgHex(getStringColor(tag.name))(` ${tag.name} `)
				: 'unknown tag';
		}

		case 'remove.issue.tag': {
			const tag = getState().tags[event.payload.tag];
			return tag
				? chalk.bgHex(getStringColor(tag.name))(` ${tag.name} `)
				: 'unknown tag';
		}

		case 'add.issue.assignee': {
			const contributor = getState().contributors[event.payload.assignee];
			return contributor
				? chalk.hex(getStringColor(contributor.name))(` ${contributor.name} `)
				: 'unknown user';
		}

		case 'remove.issue.assignee': {
			const contributor = getState().contributors[event.payload.assignee];
			return contributor
				? chalk.hex(getStringColor(contributor.name))(` ${contributor.name} `)
				: 'unknown user';
		}

		case 'add.board':
		case 'add.swimlane':
		case 'add.issue':
		case 'add.field':
		case 'create.tag':
		case 'create.contributor':
		case 'edit.title': {
			return `"${'name' in event.payload ? event.payload.name : ''}"`;
		}

		default:
			return '';
	}
};

const formatLogTime = (id: string): string => {
	const ago = timeAgo(decodeTime(id));
	return chalk.gray(padVisibleStart(ago, 8));
};

const USER_COL_WIDTH = 12;

const formatUser = (userName: string): string => {
	return padVisibleEnd(`${userName}`, USER_COL_WIDTH);
};

export const formatLogLine = <T extends AppEvent['action']>(
	event: AppEvent<T>,
	logEvolution: LogEvolutionForEvent<T>,
): string => {
	const time = formatLogTime(event.id);
	const user = formatUser(event.userName);
	const bullet = chalk.dim('›');

	const main =
		event.action === 'move.node'
			? formatMoveLogMain(
					event as AppEvent<'move.node'>,
					logEvolution as LogEvolutionForEvent<'move.node'>,
			  )
			: [formatLogAction(event.action), formatEventDetails(event)]
					.filter(Boolean)
					.join(' ');

	return `${user} ${time} ${bullet} ${main}`;
};
