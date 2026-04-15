import chalk from 'chalk';
import {Mode} from '../model/action-map.model.js';
import {NavNodeCtx} from '../model/context.model.js';
import {theme} from '../theme/themes.js';

const initCommandPalette = `: for command line`;

const exit = `q to exit`;

const confirmMove = `${chalk.hex(theme.accent)('m')} to confirm`;

export const Hints = {
	[NavNodeCtx.WORKSPACE]: [initCommandPalette],
	[NavNodeCtx.BOARD]: [initCommandPalette],
	[NavNodeCtx.BOARD + Mode.COMMAND_LINE]: [initCommandPalette],
	[NavNodeCtx.SWIMLANE]: [initCommandPalette],
	[NavNodeCtx.TICKET + Mode.HELP]: [exit],
	[NavNodeCtx.SWIMLANE + Mode.HELP]: [exit],
	[NavNodeCtx.TICKET]: [],
	[NavNodeCtx.FIELD]: [],
	[NavNodeCtx.SWIMLANE + Mode.MOVE]: [confirmMove],
	[NavNodeCtx.TICKET + Mode.MOVE]: [confirmMove],
};
