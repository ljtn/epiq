import chalk from 'chalk';
import {decodeTime} from 'ulid';
import {timeAgo} from './date-utils.js';
import {AppEvent} from './event.model.js';
import {capitalize} from '../lib/utils/string.utils.js';
import {nodeRepo} from '../repository/node-repo.js';
import {getState} from '../lib/state/state.js';
import {getTagColor} from '../lib/components/Tag.js';

const formatLogAction = (action: string): string => {
	const pretty = (() => {
		const [verb, obj] = action.split('.');
		if (!verb || !obj) return capitalize(action);

		const pastTbl = {
			init: 'Initialized',
			add: 'Created',
			edit: 'Edited',
			delete: 'Deleted',
			create: 'Created',
			assign: 'Assigned',
			tag: 'Tagged',
			move: 'Moved',
			close: 'Closed',
			reopen: 'Reopened',
			lock: 'Locked',
		} as const;

		const toPast = (value: string): string =>
			pastTbl[value as keyof typeof pastTbl] ??
			(value.endsWith('e') ? `${value}d` : `${value}ed`);

		return toPast(verb);
	})();

	return pretty;
};

const formatEventDetails = (event: AppEvent): string => {
	switch (event.action) {
		case 'move.node': {
			const parent = nodeRepo.getNode(event.payload.parent);
			return parent ? `to ${chalk.bgBlack(` ${parent.title} `)}` : 'to unknown';
		}

		case 'tag.issue': {
			const tag = getState().tags[event.payload.tagId];
			return tag
				? `${chalk.bgHex(getTagColor(tag.name))(` ${tag.name} `)}`
				: 'unknown tag';
		}

		case 'assign.issue': {
			const contributor = getState().contributors[event.payload.contributor];
			return contributor
				? `${chalk.bgBlack(` ${contributor.name} `)}`
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
	return chalk.gray(ago.padStart(8));
};

const USER_COL_WIDTH = 12;

const formatUser = (userId: string): string => {
	const raw = `by ${userId}`.padStart(USER_COL_WIDTH);
	return chalk.dim(raw);
};

export const formatLogLine = (event: AppEvent): string => {
	const time = formatLogTime(event.id);
	const user = formatUser(event.userId);
	const action = formatLogAction(event.action);
	const details = formatEventDetails(event);
	const bullet = chalk.dim('›');

	return `${time} ${bullet} ${(action + ' ' + details).padEnd(
		20,
	)} ${user}`.trim();
};
