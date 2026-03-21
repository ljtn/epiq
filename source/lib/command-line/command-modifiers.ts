import {nodeRepository} from '../repository/node-repository.js';
import {TAGS_DEFAULT} from '../static/default-tags.js';
import {CmdKeyword, CmdKeywords} from './command-types.js';

export const getCmdModifiers = (): Record<CmdKeyword, string[]> => ({
	[CmdKeywords.DELETE]: ['confirm'],
	[CmdKeywords.VIEW]: ['dense', 'wide'],
	[CmdKeywords.TAG]: [
		...new Set([
			...Object.keys(TAGS_DEFAULT),
			...nodeRepository.getExistingTags(),
		]),
	],
	[CmdKeywords.ASSIGN]: nodeRepository.getExistingAssignees(),
	[CmdKeywords.HELP]: [],
	[CmdKeywords.RENAME]: [],
	[CmdKeywords.NEW]: ['issue', 'swimlane', 'board'],
});
