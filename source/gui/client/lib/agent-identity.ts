// An agent's board identity is `provider/name` — claude/peter, codex/fred —
// which is how the log tells its writers apart. Drawn, the provider goes and
// the slash stays: `/peter` is as much as a column of signatures needs to say
// whose line it is, and the full name is in the title.

export type ActorDisplay = {
	// What is written: the name behind its slash, or the whole name where it is
	// not an agent's.
	label: string;
	isAgent: boolean;
};

export const actorDisplay = (name: string): ActorDisplay => {
	const slash = name.indexOf('/');
	const rest = name.slice(slash + 1);

	return slash > 0 && rest.length > 0 && !rest.includes('/')
		? {label: `/${rest}`, isAgent: true}
		: {label: name, isAgent: false};
};

// The width a drawn actor takes in characters, for sizing the column it sits
// in: what is written, not what is stored.
export const actorDisplayChars = (name: string): number =>
	actorDisplay(name).label.length;
