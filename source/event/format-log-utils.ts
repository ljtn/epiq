import chalk from 'chalk';
import {decodeTime} from 'ulid';
import {timeAgo} from './date-utils.js';
import {AppEvent} from './event.model.js';
import {capitalize} from '../lib/utils/string.utils.js';

const formatLogAction = (action: string): string => {
	const pretty = capitalize(action).replace('.', ' ');

	switch (action) {
		case 'create.issue':
			return chalk.green(pretty);
		case 'close.issue':
			return chalk.red(pretty);
		case 'reopen.issue':
			return chalk.yellow(pretty);
		case 'move.issue':
			return chalk.cyan(pretty);
		case 'rename.issue':
		case 'edit.description':
			return chalk.blue(pretty);
		case 'assign.user':
			return chalk.magenta(pretty);
		case 'unassign.user':
			return chalk.hex('#ff88cc')(pretty);
		case 'add.tag':
			return chalk.hex('#7cdeff')(pretty);
		case 'remove.tag':
			return chalk.hex('#ffb86c')(pretty);
		default:
			return chalk.white(pretty);
	}
};

const formatLogTime = (id: string): string => {
	const ago = timeAgo(decodeTime(id));
	return chalk.gray(ago.padStart(8));
};

export const formatLogLine = (event: AppEvent): string => {
	const time = formatLogTime(event.payload.id);
	const action = formatLogAction(event.action);
	const bullet = chalk.dim('•');

	return `${time} ${bullet} ${action}`;
};
