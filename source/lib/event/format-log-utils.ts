import chalk from 'chalk';
import stringWidth from 'string-width';
import {decodeTime} from 'ulid';
import {getState} from '../state/state.js';
import {getStringColor} from '../utils/color.js';
import {nodeRepo} from '../repository/node-repo.js';
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
	};

	return (
		pastTbl[action as EventAction] ??
		(action.endsWith('e') ? `${action}d` : `${action}ed`)
	);
};

const formatEventDetails = (event: AppEvent): string => {
	switch (event.action) {
		case 'move.node': {
			const parent = nodeRepo.getNode(event.payload.parent);
			const parentLabel = parent
				? chalk.dim.bgBlack(` ${parent.title} `)
				: 'unknown';

			return `to ${parentLabel} with rank ${event.payload.rank}`;
		}

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

export const formatLogLine = (event: AppEvent): string => {
	const time = formatLogTime(event.id);
	const user = formatUser(event.userName);
	const action = formatLogAction(event.action);
	const details = formatEventDetails(event);
	const bullet = chalk.dim('›');

	const main = [action, details].filter(Boolean).join(' ');
	return `${user} ${time} ${bullet} ${main}`;
};
