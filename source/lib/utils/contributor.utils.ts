import {getState} from '../state/state.js';

/** Whether they have written any event the board applied. Ids only. */
export const hasAuthoredEvents = (contributorId: string): boolean =>
	Boolean(getState().authors?.[contributorId]);
