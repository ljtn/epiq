import {editorConfig} from '../../editor/editor-config.js';
import {nodeRepo} from '../../repository/node-repo.js';
import {NavNodeCtx} from '../model/context.model.js';
import {getRenderedChildren, getState} from '../state/state.js';
import {TAGS_DEFAULT} from '../static/default-tags.js';
import {CmdKeyword, CmdKeywords} from './command-types.js';

export type CommandMap = {
	[K in keyof typeof NavNodeCtx]: (typeof CmdKeywords)[keyof typeof CmdKeywords][];
};

export const getCmdModifiers = (keyword: CmdKeyword): string[] => {
	const {currentNode, selectedIndex} = getState();
	const targetNode = getRenderedChildren(currentNode.id)[selectedIndex];

	if (!targetNode) {
		return [];
	}

	const globalCommands = [
		CmdKeywords.FILTER,
		CmdKeywords.SET_VIEW,
		CmdKeywords.SET_EDITOR,
		CmdKeywords.HELP,
	];
	const generalEditCommands = [
		CmdKeywords.NEW,
		CmdKeywords.RENAME,
		CmdKeywords.DELETE,
	];
	const updateTicketCommands = [
		CmdKeywords.TAG,
		CmdKeywords.ASSIGN,
		CmdKeywords.CLOSE_ISSUE,
		CmdKeywords.RE_OPEN_ISSUE,
		CmdKeywords.SET_DESCRIPTION,
	];
	const commandMap: CommandMap = {
		WORKSPACE: [...globalCommands],
		BOARD: [...globalCommands, ...generalEditCommands],
		SWIMLANE: [...globalCommands, ...generalEditCommands],
		TICKET: [
			...globalCommands,
			...generalEditCommands,
			...updateTicketCommands,
		],
		FIELD: [...globalCommands, ...updateTicketCommands],
		FIELD_LIST: [...globalCommands, ...updateTicketCommands],
		TEXT: [...globalCommands, CmdKeywords.SET_DESCRIPTION],
	};

	const modifiers = {
		[CmdKeywords.SET_USERNAME]: [],
		[CmdKeywords.SET_DESCRIPTION]: ['confirm'],
		[CmdKeywords.DELETE]: ['confirm'],
		[CmdKeywords.RE_OPEN_ISSUE]: ['confirm'],
		[CmdKeywords.MOVE]: [
			// ===================================================================
			// ====== THESE ARE BLOCKED FOR USERS, BUT USED BY THE SYSTEM ========
			// ===================================================================
			//
			'start',
			'confirm',
			'next',
			'previous',
			'to-next',
			'to-previous',
			'cancel',
		],
		[CmdKeywords.CLOSE_ISSUE]: ['confirm'],
		[CmdKeywords.FILTER]: ['tag', 'assignee', 'description', 'title', 'clear'],
		[CmdKeywords.SET_VIEW]: ['dense', 'wide'],
		[CmdKeywords.SET_EDITOR]: [...editorConfig],
		[CmdKeywords.TAG]: [
			...new Set([...Object.keys(TAGS_DEFAULT), ...nodeRepo.getExistingTags()]),
		],
		[CmdKeywords.ASSIGN]: nodeRepo.getExistingAssignees(),
		[CmdKeywords.HELP]: [],
		[CmdKeywords.RENAME]: [],

		[CmdKeywords.NEW]: ['issue', 'swimlane', 'board'],
		[CmdKeywords.NONE]: [...commandMap[targetNode?.context]],
	};

	return modifiers[keyword];
};
