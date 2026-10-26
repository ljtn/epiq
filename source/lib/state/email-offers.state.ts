/**
 * The addresses last offered for claiming, so the keystroke validator never
 * shells out to git. Stale is fine: the command re-scans before writing.
 */
let offered: string[] = [];

export const setOfferedEmails = (emails: string[]): void => {
	offered = emails;
};

export const getOfferedEmails = (): string[] => offered;
