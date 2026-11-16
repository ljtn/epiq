import {useSyncExternalStore} from 'react';

/** The questions about this machine, in the order setup asks them. */
export const MACHINE_STEPS = ['username', 'editor', 'autoSync'] as const;
export type MachineStep = (typeof MACHINE_STEPS)[number];

export type SetupSession = {
	// The step a `:setup` rerun is on; unset outside one.
	rerunStep?: MachineStep;
	// Setup was unfinished when an answer came in, so finishing it hands over.
	inProgress?: boolean;
	// Finished in this run: the next screen says so and offers what comes next.
	justCompleted?: boolean;
};

// Process memory, apart from the board's state, which a rebuild replaces.
let session: SetupSession = {};
const listeners = new Set<() => void>();

export const getSetupSession = (): SetupSession => session;

export const patchSetupSession = (patch: Partial<SetupSession>): void => {
	session = {...session, ...patch};
	for (const listener of listeners) listener();
};

export const resetSetupSession = (): void => {
	session = {};
	for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

export const useSetupSession = () =>
	useSyncExternalStore(subscribe, getSetupSession, getSetupSession);
