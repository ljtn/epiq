export const CmdKeywords = {
	INIT: 'init',
	HELP: 'help',
	NEW: 'new',
	TAG: 'tag',
	UNTAG: 'untag',
	MOVE: 'move',

	PEEK: 'peek',
	FILTER: 'filter',

	ASSIGN: 'assign',
	UNASSIGN: 'unassign',
	DELETE: 'delete',
	RENAME: 'rename',

	CLOSE_ISSUE: 'close',
	RE_OPEN_ISSUE: 'reopen',
	SET_DESCRIPTION: 'edit',

	SET_EDITOR: 'config:editor',
	SET_VIEW: 'config:view',
	SET_USERNAME: 'config:username',

	// Git
	SYNC: 'sync',

	NONE: '',
} as const;
export type CmdKeyword = (typeof CmdKeywords)[keyof typeof CmdKeywords];
