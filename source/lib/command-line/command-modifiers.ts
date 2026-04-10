import {nodeRepo} from '../../repository/node-repo.js';
import {TAGS_DEFAULT} from '../static/default-tags.js';
import {CmdKeyword, CmdKeywords} from './command-types.js';

export const getCmdModifiers = (): Record<CmdKeyword, string[]> => ({
	[CmdKeywords.DELETE]: ['confirm'],
	[CmdKeywords.VIEW]: ['dense', 'wide'],
	[CmdKeywords.NONE]: [...new Set([...Object.values(CmdKeywords)])],
	[CmdKeywords.TAG]: [
		...new Set([...Object.keys(TAGS_DEFAULT), ...nodeRepo.getExistingTags()]),
	],
	[CmdKeywords.ASSIGN]: nodeRepo.getExistingAssignees(),
	[CmdKeywords.HELP]: [],
	[CmdKeywords.RENAME]: [],
	[CmdKeywords.NEW]: ['issue', 'swimlane', 'board'],
});
