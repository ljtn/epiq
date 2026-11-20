// Who wants to know when this process has appended a line to the log.

type Listener = (rootDir: string, filePath: string, line: string) => void;

const listeners = new Set<Listener>();

/** Calls `listener` after each line this process appends; returns its removal. */
export const onOwnAppend = (listener: Listener): (() => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

export const announceOwnAppend = (
	rootDir: string,
	filePath: string,
	line: string,
): void => {
	for (const listener of listeners) listener(rootDir, filePath, line);
};

type AheadListener = (rootDir: string) => void;
const aheadListeners = new Set<AheadListener>();

/** Calls `listener` when the state holds what no log does: a write applied, then lost. */
export const onStateAhead = (listener: AheadListener): (() => void) => {
	aheadListeners.add(listener);
	return () => aheadListeners.delete(listener);
};

export const announceStateAhead = (rootDir: string): void => {
	for (const listener of aheadListeners) listener(rootDir);
};
