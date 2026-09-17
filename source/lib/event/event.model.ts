import {Result} from '../model/result-types.js';

/**
 * The shape a product hands the log: one entry per action, naming what the
 * event carries and what applying it yields. The log knows nothing else about
 * the events it orders, stores and replays.
 */
export type EventMap = Record<string, {payload: unknown; result: unknown}>;

export type ActionOf<M extends EventMap> = keyof M & string;

/**
 * Who an event is by, and the whole of what it records about them.
 *
 * An id, and never a display name. A name is a property of the subject, held
 * wherever the product holds those, so that renaming reaches every line at
 * once — including the ones written before it. Stored beside an id it would
 * freeze at whatever its subject was called that day, and the same event
 * applied in place and replayed from disk would disagree about it, since only
 * the live path ever knew it.
 */
export type Actor = {userId: string};

/**
 * The actor of an event, taken from a configured identity that carries a
 * display name beside the id.
 *
 * Its own step because the compiler will not hold this line: TypeScript
 * excess-checks the properties written in an object literal, not the ones a
 * spread brings, so `{...user}` puts the name back on the event and typechecks
 * clean. `stripActor` keeps it off disk either way, which is what makes the
 * slip silent — the event applied in place would carry a name the same event
 * decoded from the log does not.
 */
export const actorOf = ({userId}: Actor): Actor => ({userId});

type StoredEventUnion<M extends EventMap> = {
	[K in ActionOf<M>]: {action: K; payload: M[K]['payload']};
}[ActionOf<M>];

/**
 * What a line in the log holds. The actor is not here: it comes off the file
 * the line lives in, so a payload can never claim to be someone else's.
 */
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
