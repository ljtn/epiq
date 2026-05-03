import {editorConfig} from '../editor/editor-config.js';
import {nodeRepo} from '../repository/node-repo.js';
import {
	getUserSetupStatus,
	isRepositoryInitialized,
} from '../config/setup-utils.js';
import {AnyContext, NavNodeCtx} from '../model/context.model.js';
import {getState} from '../state/state.js';
import {TAGS_DEFAULT} from '../static/default-tags.js';
import {
	ticketAssigneesFromBreadCrumb,
	ticketTagsFromBreadCrumb,
} from '../utils/ticket.utils.js';
import {CmdKeyword} from './cmd-keywords.js';
import {CmdKeywords} from './cmd-keywords.js';
import {generatePeekOffsetHints} from './validate-date.js';

const EDITABLE_NODES: AnyContext[] = ['BOARD', 'TICKET', 'SWIMLANE'];

export type CommandMap = {
	[K in keyof typeof NavNodeCtx]: (typeof CmdKeywords)[keyof typeof CmdKeywords][];
};

const GLOBAL_COMMANDS = [
	CmdKeywords.SYNC,
	CmdKeywords.HELP,
	CmdKeywords.EXPORT,
	CmdKeywords.SET_VIEW,
	CmdKeywords.SET_EDITOR,
	CmdKeywords.SET_USERNAME,
];

const EDIT_COMMANDS = [
	CmdKeywords.NEW,
	CmdKeywords.RENAME,
	CmdKeywords.DELETE,
	CmdKeywords.MOVE,
];

const TICKET_COMMANDS = [
	CmdKeywords.TAG,
	CmdKeywords.UNTAG,
	CmdKeywords.ASSIGN,
	CmdKeywords.UNASSIGN,
	CmdKeywords.CLOSE_ISSUE,
	CmdKeywords.RE_OPEN_ISSUE,
	CmdKeywords.SET_DESCRIPTION,
];

const PRESENTATION_COMMANDS = [CmdKeywords.FILTER, CmdKeywords.PEEK];

const COMMANDS_BY_CONTEXT: CommandMap = {
	WORKSPACE: [...GLOBAL_COMMANDS, ...EDIT_COMMANDS],
	BOARD: [...PRESENTATION_COMMANDS, ...GLOBAL_COMMANDS, ...EDIT_COMMANDS],
	SWIMLANE: [...PRESENTATION_COMMANDS, ...GLOBAL_COMMANDS, ...EDIT_COMMANDS],
	TICKET: [...GLOBAL_COMMANDS, ...EDIT_COMMANDS, ...TICKET_COMMANDS],
	FIELD: [...GLOBAL_COMMANDS, ...TICKET_COMMANDS],
	FIELD_LIST: [...GLOBAL_COMMANDS, ...TICKET_COMMANDS],
	TEXT: [...GLOBAL_COMMANDS],
};

const getNewModifiers = (context: AnyContext): string[] => {
	if (context === 'WORKSPACE') return ['board'];

	return ['issue', 'swimlane', 'board'];
};

const getAvailableBaseCommands = (): CmdKeyword[] => {
	const {currentNode, selectedNode, readOnly} = getState();

	const isSetupComplete = getUserSetupStatus().isSetup;
	if (!isSetupComplete) {
		return [CmdKeywords.HELP, CmdKeywords.SET_EDITOR, CmdKeywords.SET_USERNAME];
	}

	if (!isRepositoryInitialized()) {
		return [CmdKeywords.HELP, CmdKeywords.INIT];
	}

	if (readOnly) {
		return [
			CmdKeywords.HELP,
			CmdKeywords.PEEK,
			CmdKeywords.EXPORT,
			CmdKeywords.SET_VIEW,
		];
	}

	const currentContext = currentNode.context ?? 'WORKSPACE';
	const selectedContext = selectedNode?.context;
	const selectedIsEditable =
		selectedContext && EDITABLE_NODES.includes(selectedContext);

	return COMMANDS_BY_CONTEXT[currentContext].filter(command => {
		if (
			command === CmdKeywords.RENAME ||
			command === CmdKeywords.DELETE ||
			command === CmdKeywords.MOVE
		) {
			return selectedIsEditable;
		}

		return true;
	});
};

export const getCmdModifiers = (keyword: CmdKeyword): string[] => {
	const {currentNode} = getState();
	const currentContext = currentNode.context ?? 'WORKSPACE';

	const modifiers: Partial<Record<CmdKeyword, string[]>> = {
		[CmdKeywords.NONE]: getAvailableBaseCommands(),

		[CmdKeywords.EXPORT]: [],
		[CmdKeywords.SYNC]: [],
		[CmdKeywords.INIT]: [],
		[CmdKeywords.HELP]: [],

		[CmdKeywords.PEEK]: [...generatePeekOffsetHints(), 'now', 'prev', 'next'],

		[CmdKeywords.SET_USERNAME]: [],
		[CmdKeywords.SET_DESCRIPTION]: ['confirm'],
		[CmdKeywords.DELETE]: ['confirm'],
		[CmdKeywords.RE_OPEN_ISSUE]: ['confirm'],
		[CmdKeywords.CLOSE_ISSUE]: ['confirm'],

		[CmdKeywords.MOVE]: [
			'start',
			'confirm',
			'next',
			'previous',
			'to-next',
			'to-previous',
			'cancel',
		],

		[CmdKeywords.FILTER]: ['tag', 'assignee', 'description', 'title', 'clear'],
		[CmdKeywords.SET_VIEW]: ['dense', 'wide'],
		[CmdKeywords.SET_EDITOR]: [...editorConfig],

		[CmdKeywords.TAG]: [
			...new Set([...Object.keys(TAGS_DEFAULT), ...nodeRepo.getExistingTags()]),
		],

		[CmdKeywords.UNTAG]: [
			...(ticketTagsFromBreadCrumb()?.value?.map(({name}) => name) ?? []),
		],

		[CmdKeywords.UNASSIGN]: [
			...(ticketAssigneesFromBreadCrumb()?.value?.map(({name}) => name) ?? []),
		],

		[CmdKeywords.ASSIGN]: nodeRepo.getExistingAssignees(),

		[CmdKeywords.RENAME]: [],
		[CmdKeywords.NEW]: getNewModifiers(currentContext),
	};

	return modifiers[keyword] ?? [];
};
