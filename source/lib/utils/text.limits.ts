// Import-free so the browser can use it. Shared by every client; the log is
// permanent and replicated, so oversized text stays forever.
export const MAX_COMMENT_LENGTH = 4000;

export const MAX_TITLE_LENGTH = 300;

// Room for a long ticket, not a document.
export const MAX_DESCRIPTION_LENGTH = 20_000;

// A board's or lane's description is handed to agents on every get and move
// there, so it stays a page of conventions, not a document.
export const MAX_SWIMLANE_DESCRIPTION_LENGTH = 2000;
export const MAX_BOARD_DESCRIPTION_LENGTH = 4000;
// What a goal is for, listed with every goal: a page, as a board's is.
export const MAX_GOAL_DESCRIPTION_LENGTH = 4000;

export const descriptionLimitOf = (
	kind: 'board' | 'swimlane' | 'goal',
): number =>
	kind === 'board'
		? MAX_BOARD_DESCRIPTION_LENGTH
		: kind === 'goal'
		? MAX_GOAL_DESCRIPTION_LENGTH
		: MAX_SWIMLANE_DESCRIPTION_LENGTH;

// Blank reads as no description everywhere, so it is stored as none.
export const normalizeDescription = (description: string): string =>
	description.trim() ? description : '';

export const MAX_TAG_NAME_LENGTH = 60;
export const MAX_ASSIGNEE_NAME_LENGTH = 80;
export const MAX_ATTACHMENT_NAME_LENGTH = 200;

// One call should not be able to mint an unbounded number of tags or
// contributors either.
export const MAX_TAGS_PER_CREATE = 20;
export const MAX_ASSIGNEES_PER_CREATE = 20;

export const tooLong = (
	label: string,
	value: string,
	max: number,
): string | null =>
	value.length > max
		? `${label} cannot exceed ${max} characters (got ${value.length})`
		: null;
