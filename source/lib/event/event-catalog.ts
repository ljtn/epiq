import {Result, ReturnFail} from '../model/result-types.js';
import {ActionOf, Event, EventMap, MaterializeResult} from './event.model.js';

/**
 * What the log needs from the product to apply its events: nothing about the
 * state they build, only how to apply one and when the state exists.
 */
export type ReplayHooks<M extends EventMap> = {
	/** Whether the state events apply to exists yet. Before genesis it does not. */
	isInitialized(): boolean;

	/**
	 * Runs a replay or a write as one unit, so the product can defer whatever
	 * it derives from state until the end.
	 */
	batch<T>(fn: () => T): Result<T>;

	/**
	 * After a handler applied an event. `batched` says a `flush` is coming, so
	 * per-event bookkeeping can be set aside and done once.
	 */
	afterApply(
		event: Event<M>,
		options: {batched: boolean; bypassLogging: boolean},
	): ReturnFail | null;

	/** Does what `afterApply` set aside during a batch. Called once per batch. */
	flush(): ReturnFail | null;
};

/**
 * What the log needs from the product before it writes: whether writing is
 * allowed at all, and anything the product wants on the log ahead of a batch.
 */
export type WriteHooks<M extends EventMap> = {
	/** Why the state cannot be written right now, or null when it can. */
	readOnlyReason(): string | null;

	/**
	 * Runs once before a batch, given the batch's first event and a way to
	 * write an event of the product's own under the same edge.
	 */
	beforeWrite(
		event: Event<M>,
		writeOne: (event: Event<M>) => Result<unknown>,
	): Result<void>;
};

export type EventHandlers<M extends EventMap> = {
	[A in ActionOf<M>]: (event: Event<M, A>) => MaterializeResult<M, A>;
};

export type EventCatalog<M extends EventMap> = {
	/**
	 * The one action that creates the state every other event reads. The only
	 * legal root of the log, and applied at most once per replay.
	 */
	genesis: ActionOf<M>;

	/** Every action this build understands. Any other is skipped on load. */
	actions: readonly ActionOf<M>[];

	/**
	 * Whether a payload has the shape its handler dereferences. A failing one
	 * is quarantined on load rather than handed to the handler.
	 */
	readPayload(action: ActionOf<M>, payload: unknown): Result<void>;

	apply: EventHandlers<M>;

	replay: ReplayHooks<M>;

	write: WriteHooks<M>;
};
