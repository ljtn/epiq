/**
 * The addresses a contributor claims on the board that is loaded.
 *
 * The answer is the board's — `emailsOf` over its links — but the question is
 * asked from `config/setup-utils`, which cannot import the state module:
 * `state` imports the default actions, which reach `command-modifiers`, which
 * reads the setup status. Importing back would close that circle, and
 * `setup-flow` already keeps its distance from `setup-utils` for the same
 * reason.
 *
 * So the reader is injected by whoever owns the state, and this module knows
 * nothing but how to call it. A reader rather than a pushed copy, because a
 * copy is a cache of board truth — which is exactly what reading the log
 * directly is meant to replace.
 */
type ClaimedEmailsReader = (contributor: string) => string[];

let read: ClaimedEmailsReader | null = null;

export const setClaimedEmailsReader = (
	reader: ClaimedEmailsReader | null,
): void => {
	read = reader;
};

/** Empty before a board is loaded, which is when nothing is claimed anyway. */
export const claimedEmailsOf = (contributor: string): string[] =>
	read ? read(contributor) : [];
