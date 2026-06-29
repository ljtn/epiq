import {MIN_AUTOSYNC_DURATION_MS} from '../../git/auto-sync.js';
import {
	getUserSetupStatus,
	isRepositoryInitialized,
} from '../config/setup-utils.js';
import {CLOSED_SWIMLANE_ID} from '../event/static-ids.js';
import {AppState} from '../model/app-state.model.js';
import {
	AnyContext,
	isTicketNode,
	NavNodeCtx,
	Ticket,
} from '../model/context.model.js';
import {nodeRepo} from '../repository/node-repo.js';
import {getState} from '../state/state.js';
import {TAGS_DEFAULT} from '../static/default-tags.js';
import {
	getTicketAssignees,
	getTicketTags,
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

// Which edit modifiers are valid depends on what is selected: swimlanes and
// boards only have a title, tickets have a title and a description, and
// comments only have their body.
export const getEditModifiers = (
	selectedContext: AnyContext | undefined = getState().selectedNode?.context,
): EditModifier[] => {
	switch (selectedContext) {
		case 'TICKET':
			return [EditModifiers.TITLE, EditModifiers.DESCRIPTION];
		case 'BOARD':
		case 'SWIMLANE':
			return [EditModifiers.TITLE];
		case 'COMMENT':
			return [EditModifiers.COMMENT];
		default:
			return [];
	}
};

export const AUTOSYNC_DEBOUNCE_HINTS = [
	String(MIN_AUTOSYNC_DURATION_MS),
	'5000',
	'15000',
	'30000',
	'60000',
];

// Suggested playback windows for `:replay <when> <duration>`. Ordered shortest
// first so the inline completion lands on the most likely choice.
export const REPLAY_DURATION_HINTS = ['10s', '20s', '30s', '45s'];

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

const PRESENTATION_COMMANDS = [
	CmdKeywords.FILTER,
	CmdKeywords.PEEK,
	CmdKeywords.REPLAY,
];

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

// The "un"-commands and close/reopen only make sense against a concrete ticket,
// so resolve the ticket currently in scope (selected, or anywhere up the
// breadcrumb) the same way the tag/assign helpers do.
const ticketInScope = ({
	breadCrumb,
	selectedNode,
}: Pick<AppState, 'breadCrumb' | 'selectedNode'>): Ticket | undefined =>
	[...breadCrumb, selectedNode].find(
		(node): node is Ticket => node != null && isTicketNode(node),
	);

const isTicketClosed = (ticket: Ticket): boolean =>
	ticket.parentNodeId === CLOSED_SWIMLANE_ID;

// `edit description` targets whichever ticket is currently in scope, which the
// edit command resolves from the breadcrumb. So whenever a ticket is in scope —
// the ticket itself or any of its descendants is selected (a virtual field, the
// text within it, a comment, ...) — the description modifier must be offered,
// even though the selected node's own context is not TICKET.
const getEditModifiersInScope = ({
	selectedNode,
	breadCrumb,
}: Pick<AppState, 'selectedNode' | 'breadCrumb'>): EditModifier[] => {
	const modifiers = getEditModifiers(selectedNode?.context);

	if (!ticketInScope({breadCrumb, selectedNode})) return modifiers;

	return modifiers.includes(EditModifiers.DESCRIPTION)
		? modifiers
		: [...modifiers, EditModifiers.DESCRIPTION];
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
			CmdKeywords.REPLAY,
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

	const ticket = ticketInScope({breadCrumb, selectedNode});

	return commandsInBreadcrumbContext.filter(command => {
		if (command === CmdKeywords.MOVE) {
			return false;
		}

		// `edit` can target the ticket in scope (e.g. `edit description`) even
		// when the selected descendant node is not itself directly editable.
		if (command === CmdKeywords.EDIT) {
			return selectedIsEditable || Boolean(ticket);
		}

		if (command === CmdKeywords.DELETE) {
			return selectedIsEditable;
		}

		// Hide the inverse commands when there is nothing to undo.
		if (command === CmdKeywords.UNTAG) {
			return Boolean(ticket && getTicketTags(ticket).length > 0);
		}

		if (command === CmdKeywords.UNASSIGN) {
			return Boolean(ticket && getTicketAssignees(ticket).length > 0);
		}

		if (command === CmdKeywords.RE_OPEN_ISSUE) {
			return Boolean(ticket && isTicketClosed(ticket));
		}

		if (command === CmdKeywords.CLOSE_ISSUE) {
			return Boolean(ticket && !isTicketClosed(ticket));
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

		// Replay only takes a historical start point (date/offset); `now`/`prev`/
		// `next` are momentary peeks with nothing to play forward.
		[CmdKeywords.REPLAY]: [...generatePeekOffsetHints()],

		[CmdKeywords.EDIT]: getEditModifiersInScope({selectedNode, breadCrumb}),

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
