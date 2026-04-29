import {editorConfig} from '../../editor/editor-config.js';
import {nodeRepo} from '../../repository/node-repo.js';
import {
	getUserSetupStatus,
	isRepositoryInitialized,
} from '../config/setup-utils.js';
import {AnyContext, NavNodeCtx} from '../model/context.model.js';
import {getState} from '../state/state.js';
import {TAGS_DEFAULT} from '../static/default-tags.js';
import {CmdKeyword, CmdKeywords} from './command-types.js';
import {generatePeekOffsetHints} from './validate-date.js';

const EDITABLE_NODES: AnyContext[] = ['BOARD', 'TICKET', 'SWIMLANE'];

export type CommandMap = {
	[K in keyof typeof NavNodeCtx]: (typeof CmdKeywords)[keyof typeof CmdKeywords][];
};

export const getCmdModifiers = (keyword: CmdKeyword): string[] => {
	const {currentNode, readOnly, selectedNode} = getState();
	const isSetupComplete = getUserSetupStatus().isSetup;

	const currentContext = currentNode.context;
	const selectedContext = selectedNode?.context;

	const globalCommands = [
		CmdKeywords.SYNC,
		CmdKeywords.HELP,
		CmdKeywords.SET_VIEW,
		CmdKeywords.SET_EDITOR,
		CmdKeywords.SET_USERNAME,
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

	const presentationLayerCommands = [CmdKeywords.FILTER, CmdKeywords.PEEK];

	const commandMap: CommandMap = {
		WORKSPACE: [...globalCommands, ...generalEditCommands],
		BOARD: [
			...presentationLayerCommands,
			...globalCommands,
			...generalEditCommands,
		],
		SWIMLANE: [
			...presentationLayerCommands,
			...globalCommands,
			...generalEditCommands,
		],
		TICKET: [
			...globalCommands,
			...generalEditCommands,
			...updateTicketCommands,
		],
		FIELD: [...globalCommands, ...updateTicketCommands],
		FIELD_LIST: [...globalCommands, ...updateTicketCommands],
		TEXT: [...globalCommands],
	};

	const isSelectedContextEditable =
		selectedContext && EDITABLE_NODES.includes(selectedContext);

	const baseCommands = [...commandMap[currentContext || 'WORKSPACE']].filter(
		cmd =>
			(
				[CmdKeywords.RENAME, CmdKeywords.DELETE, CmdKeywords.MOVE] as string[]
			).includes(cmd)
				? isSelectedContextEditable
				: true,
	);

	let modifiers: Partial<Record<CmdKeyword, string[]>> = {
		[CmdKeywords.PEEK]: [...generatePeekOffsetHints(), 'now', 'prev', 'next'],
		[CmdKeywords.SYNC]: [],
		[CmdKeywords.INIT]: [],
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
		[CmdKeywords.SET_EDITOR]: [...editorConfig, 'vim'],
		[CmdKeywords.TAG]: [
			...new Set([...Object.keys(TAGS_DEFAULT), ...nodeRepo.getExistingTags()]),
		],
		[CmdKeywords.ASSIGN]: nodeRepo.getExistingAssignees(),
		[CmdKeywords.HELP]: [],
		[CmdKeywords.RENAME]: [],
		[CmdKeywords.NEW]:
			currentContext === 'TICKET' ||
			currentContext === 'FIELD' ||
			currentContext === 'FIELD_LIST'
				? ['issue', 'swimlane', 'board']
				: currentContext === 'SWIMLANE'
				? ['issue', 'swimlane', 'board']
				: currentContext === 'BOARD'
				? ['issue', 'swimlane', 'board']
				: ['board'],
		[CmdKeywords.NONE]: baseCommands,
	};

	if (!isSetupComplete) {
		modifiers = {
			[CmdKeywords.NONE]: [
				CmdKeywords.HELP,
				CmdKeywords.SET_EDITOR,
				CmdKeywords.SET_USERNAME,
			],
			[CmdKeywords.HELP]: modifiers[CmdKeywords.HELP],
			[CmdKeywords.SET_EDITOR]: modifiers[CmdKeywords.SET_EDITOR],
			[CmdKeywords.SET_USERNAME]: modifiers[CmdKeywords.SET_USERNAME],
		};
	} else if (!isRepositoryInitialized()) {
		modifiers = {
			[CmdKeywords.NONE]: [CmdKeywords.HELP, CmdKeywords.INIT],
			[CmdKeywords.HELP]: modifiers[CmdKeywords.HELP],
			[CmdKeywords.INIT]: modifiers[CmdKeywords.INIT],
		};
	} else if (readOnly) {
		modifiers = {
			[CmdKeywords.NONE]: [CmdKeywords.HELP, CmdKeywords.PEEK],
			[CmdKeywords.HELP]: modifiers[CmdKeywords.HELP],
			[CmdKeywords.PEEK]: modifiers[CmdKeywords.PEEK],
		};
	}

	return modifiers[keyword] ?? [];
};
