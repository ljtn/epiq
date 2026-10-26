import {MUTATING_MESSAGE_TYPES} from './gui-mutations';

/**
 * Holds broadcast state while one of this client's mutations is unanswered,
 * since an older state can land after the optimistic update.
 */
export const createMutationGate = () => {
	let pending = 0;

	return {
		sent(type: string): void {
			if (MUTATING_MESSAGE_TYPES.has(type)) pending += 1;
		},

		/** `error` counts too: the handler paths that fail early send no result. */
		received(type: string | undefined): void {
			if (type === 'error' || type?.endsWith(':result')) {
				pending = Math.max(0, pending - 1);
			}
		},

		/** A reply owed on a closed socket never arrives. */
		reset(): void {
			pending = 0;
		},

		holdsState(): boolean {
			return pending > 0;
		},
	};
};
