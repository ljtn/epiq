import {settings} from '../settings/settings.js';
import {TAGS_DEFAULT} from '../static/default-tags.js';
import {CmdKeyword, CmdKeywords} from './command-types.js';

export const cmdModifiers: Record<CmdKeyword, string[]> = {
	[CmdKeywords.DELETE]: ['confirm'],
	[CmdKeywords.VIEW]: ['dense', 'wide'],
	[CmdKeywords.TAG]: Object.keys(TAGS_DEFAULT),
	[CmdKeywords.ASSIGN]: [...settings.users],
	[CmdKeywords.HELP]: [],
	[CmdKeywords.RENAME]: [],
	[CmdKeywords.NEW]: ['issue', 'swimlane', 'board'],
};
