import chalk from 'chalk';
import {decodeTime} from 'ulid';
import stringWidth from 'string-width';
import {timeAgo} from './date-utils.js';
import {AppEvent, EventAction} from './event.model.js';
import {capitalize} from '../lib/utils/string.utils.js';
import {nodeRepo} from '../repository/node-repo.js';
import {getState} from '../lib/state/state.js';
import {getTagColor} from '../lib/components/Tag.js';

const padVisibleEnd = (value: string, width: number): string =>
	value + ' '.repeat(Math.max(0, width - stringWidth(value)));

const padVisibleStart = (value: string, width: number): string =>
	' '.repeat(Math.max(0, width - stringWidth(value))) + value;

const formatLogAction = (action: string): string => {
	const pretty = (() => {
		const pastTbl: Partial<Record<EventAction, string>> = {
			'add.issue': 'Created with title',
			'assign.issue': 'Assigned to',
			'close.issue': 'Closed',
			'delete.node': 'Deleted',
			'edit.title': 'Changed title to',
			'edit.description': 'Changed description',
			'reopen.issue': 'Reopened',
			'tag.issue': 'Tagged with',
			'lock.node': 'Locked node',
			'move.node': 'Moved issue to',
		};

		const toPast = (value: string): string =>
			pastTbl[value as keyof typeof pastTbl] ??
			(value.endsWith('e') ? `${value}d` : `${value}ed`);

		return toPast(action);
	})();

	return pretty;
};

const formatEventDetails = (event: AppEvent): string => {
	switch (event.action) {
		case 'move.node': {
			const parent = nodeRepo.getNode(event.payload.parent);
			return parent ? `${chalk.bgBlack(` ${parent.title} `)}` : 'to unknown';
		}

		case 'tag.issue': {
			const tag = getState().tags[event.payload.tagId];
			return tag
				? chalk.bgHex(getTagColor(tag.name))(` ${tag.name} `)
				: 'unknown tag';
		}

		case 'assign.issue': {
			const contributor = getState().contributors[event.payload.contributor];
			return contributor
				? chalk.bgBlack(` ${contributor.name} `)
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

const formatUser = (userId: string): string => {
	return chalk.dim(padVisibleEnd(`${userId}`, USER_COL_WIDTH));
};

export const formatLogLine = (event: AppEvent): string => {
	const time = formatLogTime(event.id);
	const user = formatUser(event.userId);
	const action = formatLogAction(event.action);
	const details = formatEventDetails(event);
	const bullet = chalk.dim('›');

	const main = [action, details].filter(Boolean).join(' ');
	return `${user} ${time} ${bullet} ${main}`;
};
