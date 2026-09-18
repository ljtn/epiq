/**
 * The addresses most recently offered for claiming, in the order they were
 * drawn.
 *
 * The scan that produces them shells out to git, and the command line validates
 * on every keystroke, synchronously. So the list is put here by whoever last
 * drew or computed it, and the validator reads it rather than scanning: a
 * completion that had to wait for a subprocess would arrive after the character
 * that asked for it.
 *
 * Stale by nature, and harmless when it is. The command re-scans before it
 * writes anything, so a suggestion that has since been claimed is refused there
 * rather than acted on.
 */
let offered: string[] = [];

export const setOfferedEmails = (emails: string[]): void => {
	offered = emails;
};

export const getOfferedEmails = (): string[] => offered;

/**
 * The addresses the viewer currently holds, for completing `:config unclaim`.
 * Kept beside the offers for the same reason: the command line validates on
 * every keystroke and cannot wait for a board read.
 */
let held: string[] = [];

export const setHeldEmails = (emails: string[]): void => {
	held = emails;
};

export const getHeldEmails = (): string[] => held;
