// An agent's board identity is `provider/name` — claude/peter, codex/fred —
// which is how the log tells its writers apart. Drawn, the provider is a mark
// rather than a word: the mark says whose agent it is at a glance and gives
// the name back its capital, so a column of them reads as people.

export type AgentProvider = 'claude' | 'codex';

export type ActorDisplay = {
	// What is written: the name with its capital, or the whole name where it
	// is not an agent's.
	label: string;
	provider: AgentProvider | null;
};

const PROVIDERS: readonly AgentProvider[] = ['claude', 'codex'];

export const actorDisplay = (name: string): ActorDisplay => {
	const slash = name.indexOf('/');

	if (slash > 0) {
		const provider = name.slice(0, slash);
		const rest = name.slice(slash + 1);

		if (
			rest.length > 0 &&
			(PROVIDERS as readonly string[]).includes(provider)
		) {
			return {
				label: rest[0]!.toUpperCase() + rest.slice(1),
				provider: provider as AgentProvider,
			};
		}
	}

	return {label: name, provider: null};
};

// How wide the mark is in the row's own characters, gap included, for sizing
// the column the name sits in.
export const MARK_CHARS = 2;

// The width a drawn actor takes in characters: the label, plus the mark's room.
export const actorDisplayChars = (name: string): number => {
	const {label, provider} = actorDisplay(name);

	return label.length + (provider ? MARK_CHARS : 0);
};
