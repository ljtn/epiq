import {nodeRepo} from '../../repository/node-repo.js';
import {TAGS_DEFAULT} from '../static/default-tags.js';
import {CmdKeyword, CmdKeywords} from './command-types.js';

export const getCmdModifiers = (): Record<CmdKeyword, string[]> => ({
	[CmdKeywords.FILTER]: ['tag', 'assignee', 'description', 'title'],
	[CmdKeywords.DELETE]: ['confirm'],
	[CmdKeywords.SET_USERNAME]: [],
	[CmdKeywords.SET_VIEW]: ['dense', 'wide'],
	[CmdKeywords.SET_EDITOR]: [
		// CLI
		'vi',
		'vim',
		'nvim',
		'nano',
		'micro',
		'emacs',
		'hx',

		// GUI
		'code',
		'code-insiders',
		'subl',
		'notepad',
		'notepad++',
		'idea',
		'webstorm',

		// Generic
		'default',
		'system',
		'$EDITOR',
		'$VISUAL',
	],
	[CmdKeywords.NONE]: [...new Set([...Object.values(CmdKeywords)])],
	[CmdKeywords.TAG]: [
		...new Set([...Object.keys(TAGS_DEFAULT), ...nodeRepo.getExistingTags()]),
	],
	[CmdKeywords.ASSIGN]: nodeRepo.getExistingAssignees(),
	[CmdKeywords.HELP]: [],
	[CmdKeywords.RENAME]: [],
	[CmdKeywords.NEW]: ['issue', 'swimlane', 'board'],
});
