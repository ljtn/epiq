import {Result} from '../model/result-types.js';

/** One entry per action: what the event carries and what applying it yields. */
export type EventMap = Record<string, {payload: unknown; result: unknown}>;

export type ActionOf<M extends EventMap> = keyof M & string;

/** Who an event is by: an id, never a display name, so renames reach every line. */
export type Actor = {userId: string};

/**
 * The actor from an identity that also has a name. Needed because `{...user}`
 * escapes excess-property checks and would put the name on the event.
 */
export const actorOf = ({userId}: Actor): Actor => ({userId});

type StoredEventUnion<M extends EventMap> = {
	[K in ActionOf<M>]: {action: K; payload: M[K]['payload']};
}[ActionOf<M>];

/** A line in the log. The actor comes from the file name, never the payload. */
export type StoredEvent<
	M extends EventMap,
	A extends ActionOf<M> = ActionOf<M>,
> = Extract<StoredEventUnion<M>, {action: A}>;

export type Event<
	M extends EventMap,
	A extends ActionOf<M> = ActionOf<M>,
> = StoredEvent<M, A> & {id: string} & Actor;

export type MaterializeResult<
	M extends EventMap,
	A extends ActionOf<M>,
> = Result<{
	action: A;
	result: M[A]['result'];
}>;

// Distributes over a union of events, so the action stays paired with its
// own payload.
type Stored<E> = E extends {action: infer A; payload: infer P}
	? {action: A; payload: P}
	: never;

export const stripActor = <
	E extends Actor & {id: string; action: string; payload: unknown},
>(
	event: E,
): Stored<E> =>
	({
		action: event.action,
		payload: event.payload,
	} as Stored<E>);
