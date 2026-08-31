// Import-free so the browser client can reach it. Shared by GUI, TUI and MCP
// so no client rejects what another accepts; storage imposes no limit.
//
// Storage imposing none is exactly why these exist: every accepted string is
// appended to a log that is never rewritten and is replicated to every clone,
// so anything oversized is permanent for everybody.
export const MAX_COMMENT_LENGTH = 4000;

export const MAX_TITLE_LENGTH = 300;

// Room for a long ticket without room for a document. The longest description
// on this board is ~4.5k, so this is several times the real ceiling while
// being small enough that one accepted string cannot bloat every clone's log.
export const MAX_DESCRIPTION_LENGTH = 20_000;
export const MAX_TAG_NAME_LENGTH = 60;
export const MAX_EPIC_NAME_LENGTH = 60;
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
