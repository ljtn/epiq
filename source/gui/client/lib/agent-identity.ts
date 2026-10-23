// An agent's board identity is `provider/name` — claude/peter, codex/fred —
// or scoped further, claude/builder/sam. Drawn, all but the last part goes and
// the slash stays: `/sam` is as much as a column of signatures needs to say
// whose line it is, and the full name is in the title and the colour.

export type ActorDisplay = {
	// What is written: the name behind its slash, or the whole name where it is
	// not an agent's.
	label: string;
	isAgent: boolean;
};

export const actorDisplay = (name: string): ActorDisplay => {
	const parts = name.split('/');

	return parts.length > 1 && parts.every(part => part.length > 0)
		? {label: `/${parts.at(-1)}`, isAgent: true}
		: {label: name, isAgent: false};
};

// The width a drawn actor takes in characters, for sizing the column it sits
// in: what is written, not what is stored.
export const actorDisplayChars = (name: string): number =>
	actorDisplay(name).label.length;
