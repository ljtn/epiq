import chalk from 'chalk';
import stringWidth from 'string-width';
import {decodeTime} from 'ulid';
import {getState} from '../lib/state/state.js';
import {getStringColor} from '../lib/utils/color.js';
import {nodeRepo} from '../repository/node-repo.js';
import {timeAgo} from './date-utils.js';
import {AppEvent, EventAction} from './event.model.js';

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
			'untag.issue': 'Removed tag',
			'lock.node': 'Locked node',
			'move.node': 'Moved issue',
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
			const parentLabel = parent
				? chalk.dim.bgBlack(` ${parent.title} `)
				: 'unknown';

			const pos = event.payload.pos;

			if (!pos) return `to ${parentLabel}`;

			switch (pos.at) {
				case 'start':
					return `to ${parentLabel} ${chalk.dim('(to top of list)')}`;
				case 'end':
					return `to ${parentLabel} ${chalk.dim('(to bottom of list)')}`;
				case 'before':
					return `to ${parentLabel} ${chalk.dim('(up in list)')}`;
				case 'after':
					return `to ${parentLabel} ${chalk.dim('(down in list)')}`;
			}
		}

		case 'tag.issue': {
			const tag = getState().tags[event.payload.tagId];
			return tag
				? chalk.bgHex(getStringColor(tag.name))(` ${tag.name} `)
				: 'unknown tag';
		}

		case 'untag.issue': {
			const tag = getState().tags[event.payload.tagId];
			return tag
				? chalk.bgHex(getStringColor(tag.name))(` ${tag.name} `)
				: 'unknown tag';
		}

		case 'assign.issue': {
			const contributor = getState().contributors[event.payload.contributor];
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
