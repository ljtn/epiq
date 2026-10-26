/**
 * The addresses a contributor claims on the loaded board. The reader is
 * injected by `state`, since `config/setup-utils` importing it would be circular.
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
