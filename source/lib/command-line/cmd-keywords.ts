export const CmdKeywords = {
	PALETTE: '?',

	EXIT: 'exit',
	INIT: 'init',
	HELP: 'help',
	NEW: 'new',
	TAG: 'tag',
	UNTAG: 'untag',
	MOVE: 'move',

	PEEK: 'peek',
	REPLAY: 'replay',
	FILTER: 'filter',

	ASSIGN: 'assign',
	UNASSIGN: 'unassign',
	DELETE: 'delete',

	CLOSE_ISSUE: 'close',
	RE_OPEN_ISSUE: 'reopen',

	COMMENT: 'comment',

	CONFIG: 'config',
	EDIT: 'edit',
	YANK: 'yank',

	// Git
	SYNC: 'sync',

	EXPORT: 'export',

	COFFEE: 'coffee',

	NONE: '',
} as const;
export type CmdKeyword = (typeof CmdKeywords)[keyof typeof CmdKeywords];
