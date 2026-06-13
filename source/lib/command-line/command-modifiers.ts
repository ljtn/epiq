import {MIN_AUTOSYNC_DURATION_MS} from '../../git/auto-sync.js';
import {
	getUserSetupStatus,
	isRepositoryInitialized,
} from '../config/setup-utils.js';
import {AppState} from '../model/app-state.model.js';
import {AnyContext, NavNodeCtx} from '../model/context.model.js';
import {nodeRepo} from '../repository/node-repo.js';
import {getState} from '../state/state.js';
import {TAGS_DEFAULT} from '../static/default-tags.js';
import {
	ticketAssigneesFromBreadCrumb,
	ticketTagsFromBreadCrumb,
} from '../utils/ticket.utils.js';
import {CmdKeyword, CmdKeywords} from './cmd-keywords.js';
import {generatePeekOffsetHints} from './validate-date.js';

const EDITABLE_NODES: AnyContext[] = ['BOARD', 'TICKET', 'SWIMLANE', 'COMMENT'];

export const ConfigModifiers = {
	EDITOR: 'editor',
	VIEW: 'view',
	USERNAME: 'username',
	AUTOSYNC: 'autoSync',
	SYNC_DEBOUNCE_MS: 'syncDebounceMs',
	LOG_LEVEL: 'logLevel',
} as const;

export type ConfigModifier =
	(typeof ConfigModifiers)[keyof typeof ConfigModifiers];

export const EditModifiers = {
	TITLE: 'title',
	DESCRIPTION: 'description',
	COMMENT: 'comment',
} as const;

export type EditModifier = (typeof EditModifiers)[keyof typeof EditModifiers];

export const CONFIG_MODIFIERS = [
	ConfigModifiers.EDITOR,
	ConfigModifiers.VIEW,
	ConfigModifiers.USERNAME,
	ConfigModifiers.AUTOSYNC,
	ConfigModifiers.SYNC_DEBOUNCE_MS,
	ConfigModifiers.LOG_LEVEL,
];

export const EDIT_MODIFIERS = [
	EditModifiers.TITLE,
	EditModifiers.DESCRIPTION,
	EditModifiers.COMMENT,
];

export const AUTOSYNC_DEBOUNCE_HINTS = [
	String(MIN_AUTOSYNC_DURATION_MS),
	'5000',
	'15000',
	'30000',
	'60000',
];

export type CommandMap = {
	[K in keyof typeof NavNodeCtx]: (typeof CmdKeywords)[keyof typeof CmdKeywords][];
};

const GLOBAL_COMMANDS = [
	CmdKeywords.COFFEE,
	CmdKeywords.EXIT,
	CmdKeywords.SYNC,
	CmdKeywords.HELP,
	CmdKeywords.EXPORT,
	CmdKeywords.CONFIG,
];

const EDIT_COMMANDS = [
	CmdKeywords.NEW,
	CmdKeywords.EDIT,
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
	CmdKeywords.EDIT,
	CmdKeywords.COMMENT,
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
	COMMENT: [CmdKeywords.EDIT, CmdKeywords.DELETE],
};

const getNewModifiers = (context: AnyContext): string[] => {
	if (context === 'WORKSPACE') return ['board'];

	return ['issue', 'swimlane', 'board'];
};

const getAvailableBaseCommands = ({
	selectedNode,
	readOnly,
	breadCrumb,
}: Pick<
	AppState,
	'selectedNode' | 'readOnly' | 'breadCrumb'
>): CmdKeyword[] => {
	const {isSetupDone} = getUserSetupStatus();
	if (!isSetupDone) {
		return [CmdKeywords.HELP, CmdKeywords.CONFIG];
	}

	if (!isRepositoryInitialized()) {
		return [CmdKeywords.HELP, CmdKeywords.INIT];
	}

	if (readOnly) {
		return [
			CmdKeywords.HELP,
			CmdKeywords.PEEK,
			CmdKeywords.EXPORT,
			CmdKeywords.CONFIG,
		];
	}

	const selectedContext = selectedNode?.context;
	const selectedIsEditable =
		selectedContext && EDITABLE_NODES.includes(selectedContext);

	const commandsInBreadcrumbContext = [
		...new Set(
			[...breadCrumb, selectedNode]
				.map(c => c?.context)
				.flatMap(c => (c ? COMMANDS_BY_CONTEXT[c] : [])),
		),
	];

	return commandsInBreadcrumbContext.filter(command => {
		if (command === CmdKeywords.MOVE) {
			return false;
		}

		if (command === CmdKeywords.EDIT || command === CmdKeywords.DELETE) {
			return selectedIsEditable;
		}

		return true;
	});
};

export const getCmdModifiers = (
	keyword: CmdKeyword,
	{
		contextNode,
		selectedNode,
		readOnly,
		breadCrumb,
	}: Pick<
		AppState,
		'selectedNode' | 'readOnly' | 'breadCrumb' | 'contextNode'
	> = getState(),
): string[] => {
	const currentContext = contextNode.context ?? 'WORKSPACE';

	const modifiers: Partial<Record<CmdKeyword, string[]>> = {
		[CmdKeywords.NONE]: getAvailableBaseCommands({
			breadCrumb,
			readOnly,
			selectedNode,
		}),

		[CmdKeywords.EXIT]: ['confirm'],
		[CmdKeywords.EXPORT]: [],
		[CmdKeywords.SYNC]: [],
		[CmdKeywords.INIT]: [],
		[CmdKeywords.HELP]: [],

		[CmdKeywords.PEEK]: [...generatePeekOffsetHints(), 'now', 'prev', 'next'],

		[CmdKeywords.EDIT]: [...EDIT_MODIFIERS],

		[CmdKeywords.COMMENT]: [],

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

		[CmdKeywords.NEW]: getNewModifiers(currentContext),

		[CmdKeywords.CONFIG]: [...CONFIG_MODIFIERS],
		[CmdKeywords.COFFEE]: ['1', '3', '5', '20', 'custom'],
	};

	return modifiers[keyword] ?? [];
};
